import { json, error } from '@sveltejs/kit';
import { getTask, orderColumn } from '$lib/server/tasks';
import { moveToColumn, type PushResult } from '$lib/server/push';
import { isStatus } from '$lib/columns';
import { errMsg } from '$lib/api';
import type { RequestHandler } from './$types';
import { readBody } from '$lib/server/http';

// A column after a drop: `ids` is its new order, `moved` the card dragged into it (absent on the column it
// left, and on a reorder within one column).
export const POST: RequestHandler = async ({ request }) => {
	const { status, ids, moved } = await readBody(request);
	if (!isStatus(status)) error(400, 'bad status');
	if (!Array.isArray(ids) || !ids.every(Number.isInteger)) error(400, 'bad ids');
	if (moved !== undefined && !(typeof moved === 'number' && Number.isInteger(moved) && ids.includes(moved))) error(400, 'bad moved');

	const res: PushResult = { pushed: [], skipped: [] };
	// Only the dragged card changes column. The rest of `ids` can be up to 90 s stale; moving those too
	// undid changes made in HubSpot or on the other laptop, and pushed the old stage back.
	const task = moved === undefined ? undefined : getTask(moved);
	if (task) {
		let p: Awaited<ReturnType<typeof moveToColumn>>;
		try {
			p = await moveToColumn(task, status);
		} catch (e) {
			error(502, `HubSpot refused the stage change: ${errMsg(e)}`);
		}
		if (p && 'stage' in p) res.pushed.push({ id: task.id, stage: p.stage });
		if (p && 'skipped' in p) res.skipped.push({ id: task.id, reason: p.skipped });
	}
	orderColumn(status, ids);
	return json(res);
};
