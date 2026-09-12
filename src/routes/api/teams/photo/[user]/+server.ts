import { error } from '@sveltejs/kit';
import { userPhoto } from '$lib/server/teams';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';
export const GET: RequestHandler = async ({ params }) => {
	let p;
	try {
		p = await userPhoto(params.user);
	} catch (e) {
		error(502, errMsg(e));
	}
	if (!p) error(404, 'no photo');
	return new Response(p.buf, { headers: { 'content-type': p.type, 'cache-control': 'private, max-age=3600' } });
};
