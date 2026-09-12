import { error } from '@sveltejs/kit';
import { sendThreadReply } from '$lib/server/teams';
import { pickUploads } from '$lib/server/uploads';
import { need, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { team, channel, message, text, uploads } = await readBody(request);
	const [t_, c_, m_] = [need(team, 'team'), need(channel, 'channel'), need(message, 'message')];
	const ups = pickUploads(uploads);
	const t = typeof text === 'string' ? text.trim() : '';
	if (!t && !ups.length) error(400, 'text or attachment required');
	return upstream(() => sendThreadReply(t_, c_, m_, t, ups), 201);
};
