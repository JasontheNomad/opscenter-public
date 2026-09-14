import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { migrate } from './migrate';

const DB_PATH = env.DB_PATH ?? 'data/opscenter.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

migrate(db);

// demo fixtures
import { DEMO, seedDemoDb } from './demo';
if (DEMO()) seedDemoDb(db);

// Small KV on the `meta` table (tokens, prefs, sync cursors). Statements prepared once.
const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?').pluck();
const metaSet = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
const metaDel = db.prepare('DELETE FROM meta WHERE key = ?');
export const meta = {
	get: (k: string) => metaGet.get(k) as string | undefined,
	set: (k: string, v: string) => metaSet.run(k, v),
	del: (k: string) => metaDel.run(k),
	json<T>(k: string, fallback: T): T {
		try {
			const raw = metaGet.get(k) as string | undefined;
			return raw ? (JSON.parse(raw) as T) : fallback;
		} catch {
			return fallback;
		}
	},
	setJson: (k: string, v: unknown) => metaSet.run(k, JSON.stringify(v))
};
