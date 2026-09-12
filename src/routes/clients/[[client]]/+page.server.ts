import { error } from '@sveltejs/kit';
import { listNotes, readNote, noteMtime } from '$lib/server/notes';
import { tasksForCompany, contactsForCompany, listCompanies } from '$lib/server/tasks';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, parent }) => {
	const { clients } = await parent(); // from ../+layout.server.ts — the vault-wide list, loaded once
	const name = params.client ?? null;
	const client = name ? clients.find((c) => c.name === name) : null;
	if (name && !client) {
		// SvelteKit doesn't log expected errors, so a 404 here leaves no trace while a 500 does.
		// Log what was asked for and how many clients there were — not the list: client names are
		// law-firm data and a cross-site page can trigger this just by navigating.
		console.error(`[clients 404] asked=${JSON.stringify(name)} had=${clients.length}`);
		error(404, 'no such client');
	}

	// A company with tickets but no folder yet stays virtual here: its folder is made by the page's first
	// "New note" (an explicit POST). Creating it in this load ran on hover-preload, and on any cross-site GET.
	const notes = client ? listNotes(client.name) : [];
	const file = url.searchParams.get('n');
	const note = client && file && notes.some((n) => n.file === file) ? { file, body: readNote(client.name, file), mtime: noteMtime(client.name, file) } : null;
	const tab = url.searchParams.get('tab') ?? 'notes';
	// "← back to card" when arriving from a board panel; only allow same-origin paths
	const from = url.searchParams.get('from');
	// '/\\evil.com' normalizes to '//evil.com' in browsers -> require a plain path
	const back = from && /^\/(?![/\\])[^\\]*$/.test(from) ? { href: from, title: url.searchParams.get('fromTitle') ?? 'card' } : null;
	return {
		client,
		notes,
		note,
		tab,
		back,
		tickets: client?.company_id ? tasksForCompany(client.company_id) : [],
		contacts: client?.company_id ? contactsForCompany(client.company_id) : [],
		companies: client && !client.company_id ? listCompanies() : []
	};
};
