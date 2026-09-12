import { redirect, error } from '@sveltejs/kit';
import { fileSignedUrl } from '$lib/server/hubspot';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';

// /api/files/<hubspot file id> -> short-lived signed URL. Works for <img src> and links.
export const GET: RequestHandler = async ({ params }) => {
	if (!/^\d+$/.test(params.id)) error(400, 'bad id');
	let url: string;
	try {
		url = await fileSignedUrl(params.id);
	} catch (e) {
		error(502, errMsg(e));
	}
	redirect(302, url);
};
