import { teamsConnected, chatMessagesCached, me, markChatRead, cachedChats, chatById } from '$lib/server/teams';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/api';

export const load: PageServerLoad = async ({ params }) => {
	if (!params.chat || !teamsConnected()) return { chat: null, messages: [], me: null, error: null };
	try {
		const my = await me();
		const chats = await cachedChats();
		// the list holds the 50 most recent; a link to an older chat (a mention, a bookmark) is fetched on its own
		const chat = chats.find((c) => c.id === params.chat) ?? (await chatById(params.chat));
		const messages = chat ? await chatMessagesCached(chat.id, my.id) : [];
		if (chat?.unread) void markChatRead(chat.id, my.id); // local seen-state is set in the layout load
		return { chat, messages, me: my, error: null };
	} catch (e) {
		return { chat: null, messages: [], me: null, error: errMsg(e) };
	}
};
