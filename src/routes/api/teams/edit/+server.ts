import { error } from '@sveltejs/kit';
import { editChatMessage, editChannelMessage } from '$lib/server/teams';
import { need, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { chat, team, channel, message, text, keep } = await readBody(request);
	const msg = need(message, 'message');
	const t = typeof text === 'string' ? text.trim() : '';
	// which pieces of the original body survive (EditPart keys). Absent = nothing was dropped.
	const k = Array.isArray(keep) ? keep.filter((x): x is string => typeof x === 'string') : null;
	// empty text is fine while something is still attached; empty of both would blank the message
	if (!t && k && !k.length) error(400, 'text or attachment required');
	if (typeof team === 'string' && typeof channel === 'string') return upstream(() => editChannelMessage(team, channel, msg, t, k));
	if (typeof chat !== 'string' || !chat) error(400, 'chat or team+channel required');
	return upstream(() => editChatMessage(chat, msg, t, k));
};
