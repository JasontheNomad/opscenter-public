import { json } from '@sveltejs/kit';
import { searchPeople } from '$lib/server/teams';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	return q.length < 2 ? json([]) : upstream(() => searchPeople(q));
};
