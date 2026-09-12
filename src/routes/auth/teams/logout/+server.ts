import { redirect } from '@sveltejs/kit';
import { teamsLogout } from '$lib/server/teams';
import type { RequestHandler } from './$types';
const out = () => {
	teamsLogout();
	redirect(302, '/teams');
};
// POST only: a GET here could be triggered by any page via <img src> (CSRF logout)
export const POST: RequestHandler = out;
