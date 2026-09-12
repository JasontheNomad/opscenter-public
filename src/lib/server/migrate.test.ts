import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, MIGRATIONS } from './migrate';

const version = (db: Database.Database) => db.pragma('user_version', { simple: true });
const cols = (db: Database.Database, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

describe('migrate', () => {
	it('builds a fresh DB to the latest version', () => {
		const db = new Database(':memory:');
		migrate(db);
		expect(version(db)).toBe(MIGRATIONS.length);
		expect(cols(db, 'tasks')).toContain('submitted_via');
		expect(cols(db, 'companies')).toContain('notes_dir');
	});

	it('is a no-op the second time', () => {
		const db = new Database(':memory:');
		migrate(db);
		db.prepare("INSERT INTO tasks (title, status) VALUES ('t', 'backlog')").run();
		migrate(db);
		expect(version(db)).toBe(MIGRATIONS.length);
		// 2 (backlog -> todo) already ran, so it doesn't run again
		expect(db.prepare('SELECT status FROM tasks').pluck().get()).toBe('backlog');
	});

	it('upgrades a pre-versioning DB that already had 1–3 applied, without redoing 3', () => {
		const db = new Database(':memory:');
		migrate(db);
		db.pragma('user_version = 0');
		db.prepare("INSERT INTO stage_map (source, hs_stage, status) VALUES ('ticket', 's1', 'doing')").run();
		db.prepare("INSERT INTO stages (source, pipeline_id, pipeline_label, stage_id, label, display_order) VALUES ('ticket', 'p', 'Customer Onboarding', 's1', 'S1', 0)").run();
		migrate(db);
		expect(version(db)).toBe(MIGRATIONS.length);
		expect(db.prepare('SELECT COUNT(*) FROM stage_map').pluck().get()).toBe(1);
	});

	it('rolls a failed migration back, version included', () => {
		const db = new Database(':memory:');
		migrate(db);
		const at = version(db);
		MIGRATIONS.push((d) => {
			d.exec('CREATE TABLE half (x)');
			throw new Error('boom');
		});
		try {
			expect(() => migrate(db)).toThrow('boom');
		} finally {
			MIGRATIONS.pop();
		}
		expect(version(db)).toBe(at);
		expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
	});
});
