import { redirect, error } from '@sveltejs/kit';
import { authCallback } from '$lib/server/teams';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';
export const GET: RequestHandler = async ({ url }) => {
	const err = url.searchParams.get('error');
	if (err) error(400, `${err}: ${url.searchParams.get('error_description') ?? ''}`);
	try {
		await authCallback(url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '');
	} catch (e) {
		error(400, errMsg(e));
	}
	redirect(302, '/teams');
};
