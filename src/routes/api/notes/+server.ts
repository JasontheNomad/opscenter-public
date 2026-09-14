import { json, error } from '@sveltejs/kit';
import { writeNote, createNote, createFolder, ensureClientFolders, folderForCompany, deleteNote, deleteFolder, listNotes, readNote, noteMtime } from '$lib/server/notes';
import { need, noContent, readBody } from '$lib/server/http';
import { errMsg } from '$lib/api';
import type { RequestHandler } from './$types';

// `client` is a vault folder path ("<clients folder>/Acme/Meetings") throughout.
// ?client=X -> that folder's notes; ?client=X&file=Y -> one note's text. Feeds the editor's `[[` list and a
// note's own window, neither of which goes through the Vault page load.
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

// { client, title } -> new note in that folder
// { company_id } -> the company's client folder, made (named after it) and linked if it has none
// { parent, name } -> new folder inside `parent` ('' = the vault's top level)
export const POST: RequestHandler = async ({ request }) => {
	const { client, title, company_id, parent, name } = await readBody(request);
	if (typeof title === 'string' && title.trim()) return json({ file: createNote(need(client, 'client'), title) }, { status: 201 });
	if (typeof company_id === 'string' && company_id) {
		ensureClientFolders([company_id]);
		const folder = folderForCompany(company_id, null);
		if (!folder) error(400, 'no client folder for that company');
		return json({ folder }, { status: 201 });
	}
	const folderName = need(name, 'name');
	let folder: string;
	try {
		folder = createFolder(typeof parent === 'string' ? parent : '', folderName);
	} catch (e) {
		error(400, errMsg(e));
	}
	return json({ folder }, { status: 201 });
};

// { client, file } -> trash note; { client } -> trash the whole folder
export const DELETE: RequestHandler = async ({ request }) => {
	const { client, file } = await readBody(request);
	const folder = need(client, 'client');
	if (typeof file === 'string' && file) return (deleteNote(folder, file), noContent());
	try {
		deleteFolder(folder);
	} catch (e) {
		error(400, errMsg(e));
	}
	return noContent();
};
