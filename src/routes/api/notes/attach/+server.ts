import { json, error } from '@sveltejs/kit';
import { saveAttachment } from '$lib/server/notes';
import { pickUploads } from '$lib/server/uploads';
import { need, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

// { client, uploads: [{name, type, data}] } -> [{ name, rel }] saved under <client>/attachments/
export const POST: RequestHandler = async ({ request }) => {
	const { client, uploads } = await readBody(request);
	const name = need(client, 'client');
	const ups = pickUploads(uploads);
	if (!ups.length) error(400, 'uploads required');
	return json(ups.map((u) => ({ name: u.name, rel: saveAttachment(name, u.name, u.data) })), { status: 201 });
};
