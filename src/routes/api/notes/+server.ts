import { json, error } from '@sveltejs/kit';
import { writeNote, createNote, createClient, linkCompanyFolder, deleteNote, deleteClient, listNotes, readNote, noteMtime } from '$lib/server/notes';
import { need, noContent, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

// ?client=X -> that client's notes; ?client=X&file=Y -> one note's text. Feeds the ticket panel's
// Notes tab and a note's own window, neither of which goes through the Clients page load.
export const GET: RequestHandler = ({ url }) => {
	const client = need(url.searchParams.get('client'), 'client');
	const file = url.searchParams.get('file');
	if (!file) return json({ notes: listNotes(client) });
	try {
		return json({ file, body: readNote(client, file), mtime: noteMtime(client, file) });
	} catch {
		error(404, 'note not found');
	}
};

// { client, file, body, base } -> { mtime }. `base` = the mtime the editor loaded; 409 if the note changed since.
export const PUT: RequestHandler = async ({ request }) => {
	const { client, file, body, base } = await readBody(request);
	const mtime = writeNote(need(client, 'client'), need(file, 'file'), typeof body === 'string' ? body : '', typeof base === 'string' ? base : null);
	if (mtime === null) error(409, 'This note changed on another device since you opened it. Copy your edits, then reopen the note.');
	return json({ mtime });
};

// { client, title } -> new note; { client, company_id? } -> new client folder (+ link to company)
export const POST: RequestHandler = async ({ request }) => {
	const { client, title, company_id } = await readBody(request);
	const name = need(client, 'client');
	if (typeof title === 'string' && title.trim()) return json({ file: createNote(name, title) }, { status: 201 });
	const folder = createClient(name);
	if (typeof company_id === 'string' && company_id) linkCompanyFolder(company_id, folder);
	return json({ folder }, { status: 201 });
};

// { client, file } -> trash note; { client } -> trash whole client folder
export const DELETE: RequestHandler = async ({ request }) => {
	const { client, file } = await readBody(request);
	const name = need(client, 'client');
	if (typeof file === 'string' && file) deleteNote(name, file);
	else deleteClient(name);
	return noContent();
};
