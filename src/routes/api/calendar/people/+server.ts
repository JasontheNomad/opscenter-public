import { json } from '@sveltejs/kit';
import { searchPeople, searchRelevantPeople } from '$lib/server/teams';
import { searchContacts } from '$lib/server/tasks';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';

// Invitee search: the org directory, then people you work with (incl. outsiders), then HubSpot contacts.
// Each source is optional — one failing (e.g. People.Read not consented yet) doesn't hide the others.
export const GET: RequestHandler = ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < 2) return json([]);
	return upstream(async () => {
		const [dir, rel] = await Promise.all([
			searchPeople(q).catch((e) => (console.error('invitee directory search:', e), [])),
			searchRelevantPeople(q).catch((e) => (console.error('invitee people search:', e), []))
		]);
		const hs = searchContacts(q).map((c) => ({ name: c.name, mail: c.email! }));
		const seen = new Set<string>();
		return [...dir, ...rel, ...hs].flatMap((p) => {
			const key = p.mail.toLowerCase();
			if (seen.has(key)) return [];
			seen.add(key);
			return [{ id: key, name: p.name, mail: p.mail }];
		}).slice(0, 12);
	});
};
