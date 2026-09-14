import { db } from './db';
import { patchTicket } from './hubspot';
import { stageStatus } from './sync';
import { DEMO } from './demo';
import { moveTask } from './tasks';
import type { Status } from '$lib/columns';
import type { Task } from '$lib/types';

export type PushResult = {
	pushed: { id: number; stage: string }[];
	skipped: { id: number; reason: string }[];
};

const targetStmt = db.prepare(
	`SELECT s.stage_id, s.label FROM stages s
	 JOIN stage_map m ON m.source = s.source AND m.hs_stage = s.stage_id
	 WHERE s.source = ? AND s.pipeline_id = ? AND m.status = ?
	 ORDER BY s.display_order LIMIT 1`
);
const setStageStmt = db.prepare('UPDATE tasks SET hs_stage = ?, hs_modified_at = COALESCE(?, hs_modified_at) WHERE id = ?');

/**
 * Push one ticket's column change to HubSpot: the first stage (display order) in its own pipeline that
 * maps to `status`. Returns the stage label pushed, `{ skipped }` when no stage maps (the move stays
 * local-only, by design), or null when the current stage already means this column. Throws when HubSpot
 * rejects the change — the caller must then not move the card locally.
 */
async function pushStatus(t: Task, status: Status): Promise<{ stage: string } | { skipped: string } | null> {
	if (stageStatus(t.source, t.hs_stage) === status) return null;
	const stage = targetStmt.get(t.source, t.hs_pipeline, status) as { stage_id: string; label: string } | undefined;
	if (!stage) return { skipped: `no HubSpot stage maps to "${status}" in this pipeline` };
	const res = DEMO() ? null : await patchTicket(t.hs_id!, { hs_pipeline_stage: stage.stage_id }); // demo: no HubSpot behind it
	setStageStmt.run(stage.stage_id, res?.updatedAt ?? null, t.id);
	return { stage: stage.label };
}

/**
 * The one way a card changes column (drag, number keys, Mark as done). HubSpot first: a local move whose
 * push failed would stick for good — sync only overrides a column when HubSpot's copy changes, and a
 * refused PATCH changes nothing there. Throws when HubSpot refuses; the card stays where it was.
 */
export async function moveToColumn(t: Task, status: Status): ReturnType<typeof pushStatus> {
	if (t.status === status) return null;
	const pushed = t.source !== 'manual' && t.hs_id ? await pushStatus(t, status) : null;
	moveTask(t.id, status);
	return pushed;
}
