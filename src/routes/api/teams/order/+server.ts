import { error } from '@sveltejs/kit';
import { noContent, readBody } from '$lib/server/http';
import { setOrder } from '$lib/server/teams';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { kind, ids } = await readBody(request);
	if (typeof kind !== 'string' || !/^(favs|chats|teams|channels:.+)$/.test(kind) || !Array.isArray(ids) || !ids.every((i) => typeof i === 'string')) error(400, 'bad body');
	setOrder(kind, ids);
	return noContent();
};
