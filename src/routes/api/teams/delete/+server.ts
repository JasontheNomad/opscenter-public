import { error } from '@sveltejs/kit';
import { deleteChatMessage, deleteChannelMessage } from '$lib/server/teams';
import { need, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { chat, team, channel, message } = await readBody(request);
	const msg = need(message, 'message');
	if (typeof team === 'string' && typeof channel === 'string') return upstream(() => deleteChannelMessage(team, channel, msg));
	if (typeof chat !== 'string' || !chat) error(400, 'chat or team+channel required');
	return upstream(() => deleteChatMessage(chat, msg));
};
