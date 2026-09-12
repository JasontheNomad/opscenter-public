import { error } from '@sveltejs/kit';
import { sharedFile } from '$lib/server/teams';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';
export const GET: RequestHandler = async ({ url }) => {
	try {
		return await sharedFile(url.searchParams.get('u') ?? '');
	} catch (e) {
		error(502, errMsg(e));
	}
};
