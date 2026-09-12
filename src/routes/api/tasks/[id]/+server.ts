import { json, error } from '@sveltejs/kit';
import { updateTask, deleteTask, getTask, setHsModified, type TaskPatch } from '$lib/server/tasks';
import { intId, noContent, readBody } from '$lib/server/http';
import { patchTicket, setTicketCompany } from '$lib/server/hubspot';
import { HS_PRIORITY, isPriority } from '$lib/priority';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = intId(params.id);
	const task = getTask(id);
	if (!task) error(404, 'not found');
	const body = await readBody(request);
	const patch: TaskPatch = {};
	if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
	if (typeof body.notes === 'string') patch.notes = body.notes;
	if (isPriority(body.priority)) patch.priority = body.priority;
	if (body.due_date === null || typeof body.due_date === 'string') patch.due_date = body.due_date;
	if (body.company_id === null || typeof body.company_id === 'string')
		patch.company_id = body.company_id || null;
	// Panel sends the list JSON-encoded (Task.checklist is a string); accept an array too
	let list: unknown = body.checklist;
	if (typeof list === 'string') {
		try { list = JSON.parse(list); } catch { list = undefined; }
	}
	if (Array.isArray(list))
		patch.checklist = JSON.stringify(
			list
				.filter((i: unknown) => i && typeof (i as { text: unknown }).text === 'string')
				.map((i: { id?: string; text: string; done?: boolean }) => ({
					id: String(i.id ?? crypto.randomUUID()),
					text: i.text.slice(0, 500),
					done: !!i.done
				}))
		);
	// HubSpot mirrors: priority and company are HubSpot's fields, so push them first — sync would overwrite
	// a local-only change within 90 s
	if (patch.priority !== undefined && task.source !== 'manual' && task.hs_id) {
		try {
			const res = await patchTicket(task.hs_id, { hs_ticket_priority: HS_PRIORITY[patch.priority] ?? '' });
			if (res?.updatedAt) setHsModified(id, res.updatedAt);
		} catch (e) {
			error(502, `HubSpot priority update failed: ${e instanceof Error ? e.message : e}`);
		}
	}
	if (patch.company_id !== undefined && patch.company_id !== task.company_id && task.source !== 'manual' && task.hs_id) {
		try {
			await setTicketCompany(task.hs_id, patch.company_id, task.company_id);
		} catch (e) {
			error(502, `HubSpot company update failed: ${e instanceof Error ? e.message : e}`);
		}
	}
	return json(updateTask(id, patch));
};

export const DELETE: RequestHandler = ({ params }) => {
	deleteTask(intId(params.id));
	return noContent();
};
