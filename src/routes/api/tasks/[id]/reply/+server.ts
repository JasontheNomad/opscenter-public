import { error } from '@sveltejs/kit';
import { markReplied } from '$lib/server/tasks';
import { createTicketReply, uploadAll } from '$lib/server/hubspot';
import { pickUploads } from '$lib/server/uploads';
import { ticketTask, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const task = ticketTask(params.id);
	const body = await readBody(request);
	const text = String(body.text ?? '').trim();
	const uploads = pickUploads(body.uploads);
	if (!text && !uploads.length) error(400, 'text or attachment required');
	const subject = String(body.subject ?? '').trim() || task.title;
	return upstream(async () => {
		// client must be able to open these -> public (unlisted) file access
		const ids = await uploadAll(uploads, 'PUBLIC_NOT_INDEXABLE');
		const created = await createTicketReply(task.hs_id, subject, text || uploads.map((u) => `Attached: ${u.name}`).join('\n'), ids, task.hs_thread_id);
		markReplied(task.id);
		return created;
	}, 201);
};
