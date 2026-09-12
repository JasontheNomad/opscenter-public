import { json } from '@sveltejs/kit';
import { folderForCompany, listNotes } from '$lib/server/notes';
import { intId } from '$lib/server/http';
import { getTask } from '$lib/server/tasks';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The client's vault notes for this ticket, for the panel's Notes tab. The folder is resolved here
// because only the server knows the company -> folder link; the browser has the ticket, not the vault.
export const GET: RequestHandler = ({ params }) => {
	const task = getTask(intId(params.id));
	if (!task) error(404, 'task not found');
	const client = folderForCompany(task.company_id ?? null, task.company_name ?? null);
	return json({ client, notes: client ? listNotes(client) : [] });
};
