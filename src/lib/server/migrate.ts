// Schema migrations. `PRAGMA user_version` records how many have run; each runs once, in its own
// transaction with the version bump, so a crash mid-migration leaves the DB as it was.
// Append only — never edit, reorder or remove a shipped entry.
// No `$env` / DB import here: `db.ts` passes its handle in, tests pass an in-memory one.
import type { Database } from 'better-sqlite3';
import { PROJECT_PIPELINE_LABEL } from '$lib/views';

// Base tables. Columns added since live in the migrations below, not here.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT NOT NULL,
	notes TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'todo',
	sort_order REAL NOT NULL DEFAULT 0,
	priority INTEGER NOT NULL DEFAULT 0,
	due_date TEXT,
	source TEXT NOT NULL DEFAULT 'manual',
	hs_id TEXT,
	hs_stage TEXT,
	hs_url TEXT,
	hs_modified_at TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_hs_idx ON tasks(source, hs_id) WHERE hs_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status, sort_order);

-- HubSpot stage <-> local column. Drives two-way sync.
CREATE TABLE IF NOT EXISTS stage_map (
	source TEXT NOT NULL,
	hs_stage TEXT NOT NULL,
	status TEXT NOT NULL,
	PRIMARY KEY (source, hs_stage)
);

-- Pipeline stage labels cache, for display + mapping.
CREATE TABLE IF NOT EXISTS stages (
	source TEXT NOT NULL,
	pipeline_id TEXT NOT NULL,
	pipeline_label TEXT NOT NULL,
	stage_id TEXT NOT NULL,
	label TEXT NOT NULL,
	display_order INTEGER NOT NULL,
	closed INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (source, stage_id)
);

CREATE TABLE IF NOT EXISTS companies (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT,
	company_id TEXT
);

-- key/value: last incremental sync timestamps etc.
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	source TEXT NOT NULL,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	status TEXT NOT NULL,
	message TEXT
);
`;

const addCol = (db: Database, table: string, col: string, ddl: string) => {
	const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
	if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
};

// 1–3 predate versioning, so a DB from before then (user_version 0) may already have them applied:
// they must stay safe to re-run. Later entries run exactly once and needn't be.
export const MIGRATIONS: ((db: Database) => void)[] = [
	// 1: columns added over time
	(db) => {
		for (const [col, ddl] of [['hs_pipeline', 'TEXT'], ['company_id', 'TEXT'], ['last_client_at', 'TEXT'], ['last_reply_at', 'TEXT'], ['checklist', "TEXT NOT NULL DEFAULT '[]'"], ['hs_changed_at', 'TEXT'], ['hs_seen_at', 'TEXT'], ['hs_change', 'TEXT'], ['description', 'TEXT'], ['hs_created_at', 'TEXT'], ['submitted_via', 'TEXT']])
			addCol(db, 'tasks', col, ddl);
		addCol(db, 'companies', 'notes_dir', 'TEXT');
	},
	// 2: backlog column removed -> fold into todo
	(db) => db.exec("UPDATE tasks SET status = 'todo' WHERE status = 'backlog'; UPDATE stage_map SET status = 'todo' WHERE status = 'backlog'"),
	// 3: Projects got its own column set (2026-09-10): drop the onboarding stage map so the next sync
	// re-seeds it from guessStatus, and null hs_modified_at so that sync re-applies HubSpot's column.
	// Guarded by its old meta flag, which is set on every DB that already ran it.
	(db) => {
		if (db.prepare("SELECT 1 FROM meta WHERE key = 'migr_project_columns'").get()) return;
		const onb = `SELECT stage_id FROM stages WHERE pipeline_label = '${PROJECT_PIPELINE_LABEL}'`;
		db.exec(`DELETE FROM stage_map WHERE hs_stage IN (${onb});
			UPDATE tasks SET hs_modified_at = NULL WHERE source = 'ticket' AND hs_stage IN (${onb});
			INSERT INTO meta (key, value) VALUES ('migr_project_columns', '1')`);
	},
	// 4: client replies now go out through a HubSpot conversation thread — the only thing the client
	// portal renders. Existing tickets are marked already-seeded so the seeder never mails a client
	// about a ticket that predates the feature.
	(db) => {
		addCol(db, 'tasks', 'hs_thread_id', 'TEXT');
		addCol(db, 'tasks', 'seed_at', 'TEXT');
		db.exec("UPDATE tasks SET seed_at = 'baseline' WHERE source = 'ticket'");
	}
];

export function migrate(db: Database) {
	db.exec(SCHEMA);
	const at = db.pragma('user_version', { simple: true }) as number;
	MIGRATIONS.slice(at).forEach((run, i) =>
		db.transaction(() => {
			run(db);
			db.pragma(`user_version = ${at + i + 1}`);
		})()
	);
}
