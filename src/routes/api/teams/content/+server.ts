import { error } from '@sveltejs/kit';
import { hostedContent } from '$lib/server/teams';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';
export const GET: RequestHandler = async ({ url }) => {
	const u = url.searchParams.get('u') ?? '';
	try {
		return await hostedContent(u);
	} catch (e) {
		error(502, errMsg(e));
	}
};
