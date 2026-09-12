import { json } from '@sveltejs/kit';
import { tasksForCompany } from '$lib/server/tasks';
import { ticketActivity } from '$lib/server/hubspot';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';

// all messages across a company's tickets, newest first, tagged with ticket title
export const GET: RequestHandler = ({ params }) => {
	const tickets = tasksForCompany(params.company).filter((t) => t.source === 'ticket' && t.hs_id);
	if (!tickets.length) return json([]);
	return upstream(async () => {
		const all = await Promise.all(
			tickets.map(async (t) => (await ticketActivity(t.hs_id!)).map((a) => ({ ...a, ticket: t.title, task_id: t.id })))
		);
		return all.flat().sort((a, b) => b.at.localeCompare(a.at));
	});
};
