import { error } from '@sveltejs/kit';
import { listNotes, readNote, noteMtime } from '$lib/server/notes';
import { tasksForCompany, contactsForCompany, listCompanies } from '$lib/server/tasks';
import { clientOf } from '$lib/notes/vault';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, parent }) => {
	const { folders } = await parent(); // from ../+layout.server.ts — the vault-wide tree, loaded once
	const path = params.path ?? '';
	const folder = path ? folders.find((f) => f.path === path) : null;
	if (path && !folder) {
		// SvelteKit doesn't log expected errors, so a 404 here leaves no trace while a 500 does.
		// Log what was asked for and how many folders there were — not the list: client names are
		// law-firm data and a cross-site page can trigger this just by navigating.
		console.error(`[vault 404] asked=${JSON.stringify(path)} had=${folders.length}`);
		error(404, 'no such folder');
	}

	const notes = folder ? listNotes(folder.path) : [];
	const file = url.searchParams.get('n');
	const note = folder && file && notes.some((n) => n.file === file) ? { file, body: readNote(folder.path, file), mtime: noteMtime(folder.path, file) } : null;
	const tab = url.searchParams.get('tab') ?? 'notes';
	// a search hit opens the note at its line
	const line = Math.max(0, Math.floor(Number(url.searchParams.get('line')) || 0));
	// "← back to card" when arriving from a board panel; only allow same-origin paths
	const from = url.searchParams.get('from');
	// '/\\evil.com' normalizes to '//evil.com' in browsers -> require a plain path
	const back = from && /^\/(?![/\\])[^\\]*$/.test(from) ? { href: from, title: url.searchParams.get('fromTitle') ?? 'card' } : null;
	return {
		folder,
		notes,
		note,
		line,
		tab,
		back,
		tickets: folder?.company_id ? tasksForCompany(folder.company_id) : [],
		contacts: folder?.company_id ? contactsForCompany(folder.company_id) : [],
		// the company picker, for a client folder not linked yet
		companies: folder && clientOf(folder.path) && !folder.company_id ? listCompanies() : []
	};
};
