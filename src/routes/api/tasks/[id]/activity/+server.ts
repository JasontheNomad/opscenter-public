import { json } from '@sveltejs/kit';
import { getTask } from '$lib/server/tasks';
import { ticketActivity, ticketContact } from '$lib/server/hubspot';
import { DEMO, demoActivity } from '$lib/server/demo';
import { intId, upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';

const EMPTY = { items: [], contact: null };
export const GET: RequestHandler = ({ params }) => {
	const task = getTask(intId(params.id));
	if (!task || task.source !== 'ticket' || !task.hs_id) return json(EMPTY);
	const hsId = task.hs_id;
	if (DEMO()) return json(demoActivity[hsId] ?? EMPTY);
	return upstream(async () => {
		const [items, contact] = await Promise.all([ticketActivity(hsId), ticketContact(hsId).catch(() => null)]);
		return { items, contact };
	});
};
