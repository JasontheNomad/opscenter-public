import { db } from './db';
import { nowIso } from '$lib/dates';
import type { Task, Company, Contact } from '$lib/types';
import type { Status } from '$lib/columns';
import { PROJECT_PIPELINE_LABEL, SUPPORT_PIPELINE_LABEL, type ViewId } from '$lib/views';

const now = nowIso;

const VIEW_WHERE: Record<ViewId, string> = {
	projects: `s.pipeline_label = '${PROJECT_PIPELINE_LABEL}'`,
	support: `s.pipeline_label = '${SUPPORT_PIPELINE_LABEL}'`,
	tasks: `t.source = 'manual'`
};

// Prepared once per view: these run on every board load and every status poll (per window, every 20 s).
const VIEWS_ = Object.keys(VIEW_WHERE) as ViewId[];
const perView = <T>(make: (where: string) => T) => Object.fromEntries(VIEWS_.map((v) => [v, make(VIEW_WHERE[v])])) as Record<ViewId, T>;
const listStmt = perView((where) =>
	db.prepare(
		`SELECT t.*, s.label AS hs_stage_label, s.pipeline_label AS hs_pipeline_label, c.name AS company_name
		 FROM tasks t
		 LEFT JOIN stages s ON s.source = t.source AND s.stage_id = t.hs_stage
		 LEFT JOIN companies c ON c.id = t.company_id
		 WHERE ${where}
		 ORDER BY t.status, t.sort_order, t.id`
	)
);
export const listTasks = (view: ViewId = 'projects'): Task[] => listStmt[view].all() as Task[];

// open (not done) tasks per view — all of them, or only those with an unseen HubSpot change
const countSql = (where: string, extra: string) =>
	db.prepare(`SELECT COUNT(*) FROM tasks t LEFT JOIN stages s ON s.source = t.source AND s.stage_id = t.hs_stage WHERE ${where} AND t.status != 'done' ${extra}`).pluck();
const openStmt = perView((w) => countSql(w, ''));
const unseenStmt = perView((w) => countSql(w, "AND t.hs_changed_at IS NOT NULL AND t.hs_changed_at > COALESCE(t.hs_seen_at, '')"));
function countPerView(unseenOnly = false): Record<ViewId, number> {
	const stmts = unseenOnly ? unseenStmt : openStmt;
	return Object.fromEntries(VIEWS_.map((v) => [v, stmts[v].get() as number])) as Record<ViewId, number>;
}
export const viewCounts = () => countPerView();

// which board a task lives on (deep links from Clients)
export function viewForTask(id: number): ViewId | null {
	const row = db
		.prepare('SELECT t.source, s.pipeline_label FROM tasks t LEFT JOIN stages s ON s.source = t.source AND s.stage_id = t.hs_stage WHERE t.id = ?')
		.get(id) as { source: string; pipeline_label: string | null } | undefined;
	if (!row) return null;
	return row.source === 'manual' ? 'tasks' : row.pipeline_label === SUPPORT_PIPELINE_LABEL ? 'support' : 'projects';
}

const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
export const getTask = (id: number) => getStmt.get(id) as Task | undefined;

// append position in a column
const maxOrderStmt = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM tasks WHERE status = ?');
export const nextSortOrder = (status: Status) => (maxOrderStmt.get(status) as { max: number }).max + 1;

export function createTask(title: string, status: Status = 'todo'): Task {
	const { lastInsertRowid } = db
		.prepare('INSERT INTO tasks (title, status, sort_order) VALUES (?, ?, ?)')
		.run(title, status, nextSortOrder(status));
	return getTask(Number(lastInsertRowid))!;
}

export type TaskPatch = Partial<
	Pick<Task, 'title' | 'notes' | 'status' | 'priority' | 'due_date' | 'company_id' | 'checklist'>
>;

// for the pickers (reply To, new ticket): only contacts they can offer — with an email, at a company
export function listContacts(): Contact[] {
	return db
		.prepare(`SELECT id, name, email, company_id FROM contacts WHERE email <> '' AND company_id IS NOT NULL ORDER BY name COLLATE NOCASE`)
		.all() as Contact[];
}

export function searchContacts(q: string, limit = 8): Contact[] {
	const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
	return db
		.prepare(`SELECT id, name, email, company_id FROM contacts WHERE email <> '' AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT ?`)
		.all(like, like, limit) as Contact[];
}

export function listCompanies(): Company[] {
	return db.prepare('SELECT id, name FROM companies ORDER BY name COLLATE NOCASE').all() as Company[];
}

export function updateTask(id: number, patch: TaskPatch): Task | undefined {
	const keys = Object.keys(patch) as (keyof TaskPatch)[];
	if (keys.length === 0) return getTask(id);
	const sets = keys.map((k) => `${k} = @${k}`).join(', ');
	db.prepare(`UPDATE tasks SET ${sets}, updated_at = @updated_at WHERE id = @id`).run({
		...patch,
		updated_at: now(),
		id
	});
	return getTask(id);
}

const repliedStmt = db.prepare('UPDATE tasks SET last_reply_at = ? WHERE id = ?');
export const markReplied = (id: number) => repliedStmt.run(nowIso(), id);

export function deleteTask(id: number): void {
	db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

// HubSpot's modified time after our own write, so the next (lagging) search reads as older (sync.ts `newer`)
const hsModifiedStmt = db.prepare('UPDATE tasks SET hs_modified_at = ? WHERE id = ?');
export const setHsModified = (id: number, at: string) => hsModifiedStmt.run(at, id);

const moveStmt = db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?');
export const moveTask = (id: number, status: Status) => moveStmt.run(status, now(), id);

// Order a column in one transaction. Only rows still in `status` are touched: `ids` is the browser's view
// of the column, up to 90 s old, so a card HubSpot or the other laptop moved away since stays where it went.
const orderStmt = db.prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ? AND status = ?');
export const orderColumn = db.transaction((status: Status, ids: number[]) => {
	const ts = now();
	ids.forEach((id, i) => orderStmt.run(i, ts, id, status));
});

export type StageRow = {
	source: string;
	pipeline_id: string;
	pipeline_label: string;
	stage_id: string;
	label: string;
	display_order: number;
	closed: number;
	status: Status | null;
};

export function listStageMap(): StageRow[] {
	return db
		.prepare(
			`SELECT s.*, m.status FROM stages s
			 LEFT JOIN stage_map m ON m.source = s.source AND m.hs_stage = s.stage_id
			 ORDER BY s.source, s.pipeline_label, s.display_order`
		)
		.all() as StageRow[];
}

export function setStageMap(source: string, hs_stage: string, status: Status) {
	db.prepare(
		'INSERT OR REPLACE INTO stage_map (source, hs_stage, status) VALUES (?, ?, ?)'
	).run(source, hs_stage, status);
}

export function tasksForCompany(companyId: string): Task[] {
	return db
		.prepare(
			`SELECT t.*, s.label AS hs_stage_label, s.pipeline_label AS hs_pipeline_label, c.name AS company_name
			 FROM tasks t
			 LEFT JOIN stages s ON s.source = t.source AND s.stage_id = t.hs_stage
			 LEFT JOIN companies c ON c.id = t.company_id
			 WHERE t.company_id = ?
			 ORDER BY t.status = 'done', t.updated_at DESC`
		)
		.all(companyId) as Task[];
}

export function contactsForCompany(companyId: string): Contact[] {
	return db
		.prepare('SELECT id, name, email, company_id FROM contacts WHERE company_id = ? ORDER BY name COLLATE NOCASE')
		.all(companyId) as Contact[];
}

// HubSpot changes not yet opened, per view (red bubbles)
export const viewUnseen = () => countPerView(true);
const seenStmt = db.prepare('UPDATE tasks SET hs_seen_at = ? WHERE id = ?');
export const markSeen = (id: number) => seenStmt.run(nowIso(), id);
export function unseenTasks(): { id: number; title: string; kind: string | null; at: string; pipeline_label: string | null }[] {
	return db
		.prepare(
			`SELECT t.id, t.title, t.hs_change AS kind, t.hs_changed_at AS at, s.pipeline_label
			 FROM tasks t LEFT JOIN stages s ON s.source = t.source AND s.stage_id = t.hs_stage
			 WHERE t.status != 'done' AND t.hs_changed_at IS NOT NULL AND t.hs_changed_at > COALESCE(t.hs_seen_at, '')
			 ORDER BY t.hs_changed_at DESC LIMIT 20`
		)
		.all() as { id: number; title: string; kind: string | null; at: string; pipeline_label: string | null }[];
}
