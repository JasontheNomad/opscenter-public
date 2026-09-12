import { error } from '@sveltejs/kit';
import { sendChatMessage, sendChannelMessage, invalidateChat, type Quote } from '$lib/server/teams';
import { pickUploads } from '$lib/server/uploads';
import { upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { chat, team, channel, text, quote, uploads } = await readBody(request);
	const ups = pickUploads(uploads);
	const t = typeof text === 'string' ? text.trim() : '';
	if (!t && !ups.length) error(400, 'text or attachment required');
	// a quoted message: only the fields we render, each checked (it's echoed into the posted HTML)
	const qo = quote && typeof quote === 'object' ? (quote as Record<string, unknown>) : null;
	const q: Quote | null =
		qo && typeof qo.id === 'string'
			? { id: qo.id, from: typeof qo.from === 'string' ? qo.from : '', fromId: typeof qo.fromId === 'string' ? qo.fromId : null, preview: typeof qo.preview === 'string' ? qo.preview : '' }
			: null;
	if (typeof team === 'string' && typeof channel === 'string') return upstream(() => sendChannelMessage(team, channel, t, q, ups), 201);
	if (typeof chat !== 'string' || !chat) error(400, 'chat or team+channel required');
	return upstream(async () => {
		const created = await sendChatMessage(chat, t, q, ups);
		invalidateChat(chat);
		return created;
	}, 201);
};
