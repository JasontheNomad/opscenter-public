import { need, noContent, readBody } from '$lib/server/http';
import { setFavorite } from '$lib/server/teams';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { id, on } = await readBody(request);
	setFavorite(need(id, 'id'), !!on);
	return noContent();
};
