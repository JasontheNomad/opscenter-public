import { db, meta } from './db';
import { nextSortOrder } from './tasks';
import { priorityFromHs } from '$lib/priority';
import { nowIso, newer } from '$lib/dates';
import { env } from '$env/dynamic/private';
import { OWNER_ID, getPipelines, searchTickets, listCompanies, listContacts, latestActivity, recordUrl, type Pipeline } from './hubspot';
import type { Status } from '$lib/columns';
import { PROJECT_PIPELINE_LABEL, columnsForPipeline } from '$lib/views';
import type { Source } from '$lib/types';
import { errMsg } from '$lib/api';

// HubSpot "Customer Success > Projects" = tickets in the Customer Onboarding pipeline (objectTypeId 0-5).
// The separate PROJECT object is unused in this portal.
const CLOSED_KEEP_DAYS = 14; // closed records older than this drop off the board

// stage labels meaning "ball in my court" (configurable per org)
const WAITING_ON_ME = new RegExp(env.HUBSPOT_WAITING_ON_ME || 'waiting on us|revision', 'i');

// Default HubSpot stage -> column guess. User can override rows in stage_map.
function guessStatus(label: string, closed: boolean, pipeline: string): Status {
	const l = label.toLowerCase();
	if (closed) return 'done';
	if (pipeline === PROJECT_PIPELINE_LABEL) {
		if (/hypercare/.test(l)) return 'hypercare';
		if (/testing|go live/.test(l)) return 'testing';
		if (/kickoff.*complete/.test(l)) return 'kickoff_done';
		if (/kickoff/.test(l)) return 'kickoff_scheduled';
		if (/new/.test(l)) return 'new_customer';
		return 'in_progress'; // build, paused, demo call
	}
	// "waiting on us" / "revisions needed" -> ball in my court
	if (WAITING_ON_ME.test(l)) return 'waiting_me';
	if (/wait|paus|hold|review|testing|hypercare/.test(l)) return 'waiting';
	if (/progress|build|execution|set-up|setup|training|revision|demo|go live|kickoff meeting/.test(l))
		return 'in_progress';
	return 'todo';
}

const upStageStmt = db.prepare(
	`INSERT OR REPLACE INTO stages (source, pipeline_id, pipeline_label, stage_id, label, display_order, closed)
	 VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const seedMapStmt = db.prepare('INSERT OR IGNORE INTO stage_map (source, hs_stage, status) VALUES (?, ?, ?)');
const dropStagesStmt = db.prepare('DELETE FROM stages WHERE source = ?');
// One transaction per sync (was ~2 autocommits per stage, every 90 s), and a stage deleted in HubSpot now
// leaves the table: it used to linger, and firstStage() could hand ticket create a stage that's gone.
// An empty answer is treated as a bad fetch — never wipe the stages on it.
const cacheStages = db.transaction((source: Source, pipelines: Pipeline[]) => {
	if (!pipelines.some((p) => p.stages.length)) return;
	dropStagesStmt.run(source);
	for (const p of pipelines)
		for (const s of p.stages) {
			const closed =
				s.metadata.ticketState === 'CLOSED' ||
				s.metadata.state === 'CLOSED' ||
				s.metadata.isClosed === 'true';
			upStageStmt.run(source, p.id, p.label, s.id, s.label, s.displayOrder, closed ? 1 : 0);
			seedMapStmt.run(source, s.id, guessStatus(s.label, closed, p.label));
		}
});

const stageStatusStmt = db.prepare('SELECT status FROM stage_map WHERE source = ? AND hs_stage = ?').pluck();
// unmapped (or null) stage -> the first column of the ticket's own board: 'todo' on Support, but
// Projects has no 'todo' column, so a Projects ticket landing there would be counted and never shown
export const stageStatus = (source: Source, stage: string | null, pipelineLabel: string | null = null): Status =>
	(stageStatusStmt.get(source, stage) as Status | undefined) ?? columnsForPipeline(pipelineLabel)[0].id;

export type Mirror = {
	hs_id: string;
	title: string;
	description: string; // HubSpot `content`: the ticket description
	hs_created_at: string | null;
	submitted_via: string | null; // set by the client portal on tickets it creates; empty on ours
	priority: number;
	hs_pipeline: string | null;
	hs_stage: string | null;
	hs_modified_at: string | null;
	hs_url: string;
	company_id: string | null;
};

// one mirror row (also used by /api/tickets for a ticket we just created). Returns the local id.
const insertStmt = db.prepare(
	`INSERT INTO tasks (title, description, hs_created_at, submitted_via, status, sort_order, priority, source, hs_id, hs_pipeline, hs_stage, hs_url, hs_modified_at, company_id, hs_seen_at)
	 VALUES (@title, @description, @hs_created_at, @submitted_via, @status, @sort_order, @priority, @source, @hs_id, @hs_pipeline, @hs_stage, @hs_url, @hs_modified_at, @company_id, @hs_seen_at)
	 ON CONFLICT DO NOTHING`
);
const mirrorIdStmt = db.prepare('SELECT id FROM tasks WHERE source = ? AND hs_id = ?').pluck();
export function insertMirror(m: Mirror, source: Source, status: Status, seenAt: string | null = null): number {
	const info = insertStmt.run({ ...m, source, status, sort_order: nextSortOrder(status), hs_seen_at: seenAt });
	if (info.changes) return Number(info.lastInsertRowid);
	// already mirrored: a sync saw the ticket between its creation and this insert (tasks_hs_idx is unique)
	return mirrorIdStmt.get(source, m.hs_id) as number;
}
// first stage (display order) of a pipeline by label — where new tickets land
export const firstStage = (label: string) =>
	db.prepare('SELECT pipeline_id, stage_id FROM stages WHERE source = ? AND pipeline_label = ? ORDER BY display_order LIMIT 1').get('ticket', label) as
		| { pipeline_id: string; stage_id: string }
		| undefined;

const pipelineLabelStmt = db.prepare('SELECT pipeline_label FROM stages WHERE source = ? AND pipeline_id = ? LIMIT 1').pluck();
const pipelineLabel = (id: string | null) => (pipelineLabelStmt.get('ticket', id) as string | undefined) ?? '';
// change log for the current sync run (consumed by notifications)
export type HsChange = { id: number; title: string; kind: 'new' | 'stage' | 'reply'; status: string; pipeline: string | null; pipeline_label: string; at: string };
let lastChanges: HsChange[] = [];
export const takeChanges = () => { const c = lastChanges; lastChanges = []; return c; };
// drop a pending change (e.g. a ticket we just created ourselves)
export const dropChange = (id: number) => { lastChanges = lastChanges.filter((c) => c.id !== id); };

const upsertMirrors = db.transaction((source: Source, rows: Mirror[]) => {
	const find = db.prepare('SELECT id, status, priority, hs_modified_at, hs_stage, title, hs_pipeline FROM tasks WHERE source = ? AND hs_id = ?');
	const flag = db.prepare("UPDATE tasks SET hs_changed_at = ?, hs_change = ? WHERE id = ?");
	const now = nowIso();
	const hadRows = (db.prepare("SELECT 1 FROM tasks WHERE source = ? LIMIT 1").get(source) as unknown) !== undefined;
	const update = db.prepare(
		`UPDATE tasks SET title = @title, description = @description, hs_created_at = @hs_created_at, submitted_via = @submitted_via, priority = @priority, hs_pipeline = @hs_pipeline,
		 hs_stage = @hs_stage, hs_url = @hs_url, hs_modified_at = @hs_modified_at, status = @status,
		 company_id = COALESCE(@company_id, company_id) WHERE id = @id`
	);
	let inserted = 0;
	for (const r of rows) {
		const hsStatus = stageStatus(source, r.hs_stage, pipelineLabel(r.hs_pipeline));
		const existing = find.get(source, r.hs_id) as
			| { id: number; status: Status; priority: number; hs_modified_at: string | null; hs_stage: string | null; title: string; hs_pipeline: string | null }
			| undefined;
		if (!existing) {
			const id = insertMirror(r, source, hsStatus);
			inserted++;
			if (hadRows && hsStatus !== 'done') { // first-ever sync = baseline, no flood
				flag.run(now, 'new', id);
				lastChanges.push({ id, title: r.title, kind: 'new', status: hsStatus, pipeline: r.hs_pipeline, pipeline_label: pipelineLabel(r.hs_pipeline), at: now });
			}
		} else {
			// HubSpot changed since we last saw it -> HubSpot wins on column, stage and priority. Otherwise keep
			// ours: search lags, so right after a drag or priority edit it can still return the old values —
			// writing those back would undo the edit and flag our own move as a HubSpot stage change.
			// "Since" means *newer*, not just different: overlapping or lagging reads come back out of order,
			// and our own pushes store HubSpot's new timestamp (push.ts, PATCH /api/tasks) ahead of search.
			const changed = newer(r.hs_modified_at, existing.hs_modified_at);
			update.run({
				...r,
				id: existing.id,
				status: changed ? hsStatus : existing.status,
				hs_stage: changed ? r.hs_stage : existing.hs_stage,
				priority: changed ? r.priority : existing.priority,
				hs_modified_at: changed ? r.hs_modified_at : existing.hs_modified_at
			});
			if (changed && existing.hs_stage && r.hs_stage && existing.hs_stage !== r.hs_stage && hsStatus !== 'done') {
				flag.run(now, 'stage', existing.id);
				lastChanges.push({ id: existing.id, title: r.title, kind: 'stage', status: hsStatus, pipeline: r.hs_pipeline, pipeline_label: pipelineLabel(r.hs_pipeline), at: now });
			}
		}
	}
	// mirrors no longer returned (reassigned / old closed) drop off.
	// Empty result = treat as a bad/partial fetch, never wipe. Rows created in the last 10 min are kept:
	// tickets we just created are not yet visible to HubSpot search (eventual consistency).
	if (rows.length === 0) return inserted;
	const keep = rows.map((r) => r.hs_id);
	const recent = new Date(Date.now() - 10 * 60_000).toISOString();
	db.prepare(
		`DELETE FROM tasks WHERE source = ? AND hs_id IS NOT NULL AND created_at < ? AND hs_id NOT IN (${keep.map(() => '?').join(',')})`
	).run(source, recent, ...keep);
	return inserted;
});

const recentEnough = (closedDate: string | null) =>
	!closedDate || Date.now() - new Date(closedDate).getTime() < CLOSED_KEEP_DAYS * 86400_000;

async function syncTickets() {
	cacheStages('ticket', await getPipelines('tickets'));
	const recs = await searchTickets(OWNER_ID(), [
		'subject',
		'content',
		'hs_pipeline',
		'hs_pipeline_stage',
		'hs_ticket_priority',
		'hs_lastmodifieddate',
		'closed_date',
		'hs_primary_company_id',
		'createdate',
		'submitted_via'
	], CLOSED_KEEP_DAYS);
	const rows: Mirror[] = recs
		.filter((r) => recentEnough(r.properties.closed_date)) // HubSpot filters the same; kept as the rule of record
		.map((r) => ({
			hs_id: r.id,
			title: r.properties.subject ?? `Ticket ${r.id}`,
			description: r.properties.content ?? '',
			hs_created_at: r.properties.createdate ?? null,
			submitted_via: r.properties.submitted_via || null,
			priority: priorityFromHs(r.properties.hs_ticket_priority),
			hs_pipeline: r.properties.hs_pipeline,
			hs_stage: r.properties.hs_pipeline_stage,
			hs_modified_at: r.properties.hs_lastmodifieddate,
			hs_url: recordUrl('0-5', r.id),
			company_id: r.properties.hs_primary_company_id || null
		}));
	upsertMirrors('ticket', rows);
	await syncLatest(rows.map((r) => r.hs_id));
	return rows.length;
}

// newest client message / our reply per open ticket -> needs-reply signal. Non-fatal.
async function syncLatest(ticketIds: string[]) {
	try {
		const latest = await latestActivity(ticketIds);
		// never overwrite with NULL: a ticket missing from a (capped) result set keeps what it had
		const up = db.prepare(
			"UPDATE tasks SET last_client_at = COALESCE(?, last_client_at), last_reply_at = COALESCE(?, last_reply_at) WHERE source = 'ticket' AND hs_id = ?"
		);
		const recent = new Date(Date.now() - 24 * 3600_000).toISOString();
		const prev = db.prepare("SELECT id, title, status, hs_pipeline, last_client_at FROM tasks WHERE source = 'ticket' AND hs_id = ?");
		const flag = db.prepare("UPDATE tasks SET hs_changed_at = ?, hs_change = 'reply' WHERE id = ?");
		const now = nowIso();
		const tx = db.transaction(() => {
			for (const id of ticketIds) {
				const l = latest.get(id);
				const before = prev.get(id) as { id: number; title: string; status: string; hs_pipeline: string | null; last_client_at: string | null } | undefined;
				up.run(l?.last_client_at ?? null, l?.last_reply_at ?? null, id);
				// newer than what we had, or the ticket's first client message (only if recent, so a fresh DB doesn't flood)
				const newer = before && l?.last_client_at && (before.last_client_at ? l.last_client_at > before.last_client_at : l.last_client_at > recent);
				if (before && l?.last_client_at && newer && before.status !== 'done') {
					flag.run(now, before.id);
					lastChanges.push({ id: before.id, title: before.title, kind: 'reply', status: before.status, pipeline: before.hs_pipeline, pipeline_label: pipelineLabel(before.hs_pipeline), at: now });
				}
			}
		});
		tx();
	} catch (e) {
		console.warn('[sync] latest activity skipped:', String(e).slice(0, 160));
	}
}

const upsertCompanies = db.transaction((rows: { id: string; name: string }[]) => {
	// upsert, not REPLACE: REPLACE deletes the row first, which wiped the local `notes_dir` folder link
	const up = db.prepare('INSERT INTO companies (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name');
	for (const c of rows) up.run(c.id, c.name);
	return rows.length;
});


const REF_OVERLAP_MS = 10 * 60_000;
// Reference data (companies, contacts): full pull once, then only records modified since last run.
// Non-fatal: a missing scope or 429 shouldn't block ticket sync.
async function syncRef<Row>(
	name: 'companies' | 'contacts',
	fetch: (since?: string) => Promise<Row[]>,
	upsert: (rows: Row[]) => number
): Promise<number | string> {
	const key = `${name}_synced_at`;
	const hasRows = (db.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get() as unknown) !== undefined;
	const last = hasRows ? meta.get(key) : undefined;
	// Look back 10 min past the last run: HubSpot search indexes late, so a record changed just before
	// `started` can be missing from that run — and a strict "since" would skip it on every run after.
	// The upsert is idempotent, so re-reading a few records costs nothing.
	const since = last ? new Date(Date.parse(last) - REF_OVERLAP_MS).toISOString() : undefined;
	const started = nowIso();
	try {
		const n = upsert(await fetch(since));
		meta.set(key, started);
		return n;
	} catch (e) {
		console.warn(`[sync] ${name} skipped:`, String(e).slice(0, 160));
		return 'skipped';
	}
}

const syncCompanies = () => syncRef('companies', listCompanies, upsertCompanies);

const upsertContacts = db.transaction(
	(rows: { id: string; name: string; email: string | null; company_id: string | null }[]) => {
		const up = db.prepare('INSERT OR REPLACE INTO contacts (id, name, email, company_id) VALUES (?, ?, ?, ?)');
		for (const c of rows) up.run(c.id, c.name, c.email, c.company_id);
		return rows.length;
	}
);

const syncContacts = () => syncRef('contacts', listContacts, upsertContacts);

// One run at a time: the poller, the Sync button and ticket create all call this, and overlapping runs
// doubled HubSpot traffic and finished out of order. A caller arriving mid-run shares that run's result.
let running: ReturnType<typeof runSync> | null = null;

// Health of background sync, for the status payload: a failing sync used to be visible nowhere, so the
// board could sit stale for days. `failingSince` is when the current run of failures began.
export const syncHealth: { lastOkAt: string | null; error: string | null; failingSince: string | null } = { lastOkAt: null, error: null, failingSince: null };
const LOG_KEEP = 500;
export function syncAll() {
	return (running ??= runSync().finally(() => (running = null)));
}

async function runSync() {
	const started = nowIso();
	const { lastInsertRowid } = db
		.prepare("INSERT INTO sync_log (source, started_at, status) VALUES ('all', ?, 'running')")
		.run(started);
	try {
		const companies = await syncCompanies();
		const contacts = await syncContacts();
		const tickets = await syncTickets();
		db.prepare("UPDATE sync_log SET finished_at = ?, status = 'ok', message = ? WHERE id = ?").run(
			nowIso(),
			`tickets=${tickets} companies=${companies} contacts=${contacts}`,
			lastInsertRowid
		);
		Object.assign(syncHealth, { lastOkAt: nowIso(), error: null, failingSince: null });
		return { tickets, companies, contacts };
	} catch (e) {
		const msg = errMsg(e);
		db.prepare("UPDATE sync_log SET finished_at = ?, status = 'error', message = ? WHERE id = ?").run(nowIso(), msg, lastInsertRowid);
		// once per new error, not every 90 s: the journal is where "why is the board stale?" gets answered
		if (msg !== syncHealth.error) console.error('[sync] HubSpot sync failed:', msg);
		Object.assign(syncHealth, { error: msg, failingSince: syncHealth.failingSince ?? started });
		throw e;
	} finally {
		// the log is only for looking back a little; it grew by ~960 rows a day, forever
		db.prepare('DELETE FROM sync_log WHERE id <= (SELECT MAX(id) FROM sync_log) - ?').run(LOG_KEEP);
	}
}
