// Shared bits for +server.ts routes: one error shape, one validation vocabulary.
import { json, error } from '@sveltejs/kit';
import { getTask } from './tasks';
import type { Task } from '$lib/types';
import { errMsg } from '$lib/api';

export const noContent = () => new Response(null, { status: 204 });

export { readBody } from './body';

// Run an upstream call (HubSpot / Graph). Resolves to JSON (or 204 when fn returns undefined); any throw -> 502 {error}.
// Validate BEFORE calling this: a kit error() thrown inside fn would also become a 502.
export async function upstream<T>(fn: () => Promise<T>, status = 200): Promise<Response> {
	try {
		const v = await fn();
		return v === undefined ? noContent() : json(v, { status });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 502 });
	}
}

export const need = (v: unknown, name: string): string => {
	if (typeof v !== 'string' || !v.trim()) error(400, `${name} required`);
	return v;
};
export const intId = (s: string): number => {
	const id = Number(s);
	if (!Number.isInteger(id)) error(400, 'bad id');
	return id;
};
// task that mirrors a HubSpot ticket, or 404 / 400
export function ticketTask(idParam: string): Task & { hs_id: string } {
	const task = getTask(intId(idParam));
	if (!task) error(404, 'not found');
	if (task.source !== 'ticket' || !task.hs_id) error(400, 'not a HubSpot ticket');
	return task as Task & { hs_id: string };
}
