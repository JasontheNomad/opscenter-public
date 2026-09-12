import { error } from '@sveltejs/kit';
import { createTicketNote, uploadAll } from '$lib/server/hubspot';
import { pickUploads } from '$lib/server/uploads';
import { ticketTask, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const task = ticketTask(params.id);
	const body = await readBody(request);
	const text = String(body.text ?? '').trim();
	const uploads = pickUploads(body.uploads);
	if (!text && !uploads.length) error(400, 'text or attachment required');
	return upstream(async () => {
		const ids = await uploadAll(uploads, 'PRIVATE');
		return createTicketNote(task.hs_id, text || uploads.map((u) => `📎 ${u.name}`).join('\n'), ids);
	}, 201);
};
