import { error } from '@sveltejs/kit';
import { reactChat, reactChannel, invalidateChat } from '$lib/server/teams';
import { need, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { chat, team, channel, message, emoji, on } = await readBody(request);
	const msg = need(message, 'message');
	const em = need(emoji, 'emoji');
	if (typeof team === 'string' && typeof channel === 'string') return upstream(() => reactChannel(team, channel, msg, em, !!on));
	if (typeof chat !== 'string' || !chat) error(400, 'chat or team+channel required');
	return upstream(async () => { await reactChat(chat, msg, em, !!on); invalidateChat(chat); });
};
