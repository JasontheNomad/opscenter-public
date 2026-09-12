import { teamsConfigured, teamsConnected, cachedChats, listTeams, favorites, me, chatOrder, applyTeamOrder, teamsStatus, markChannelSeen, markChatSeenLocal, notifyPrefs, activityUnseen } from '$lib/server/teams';
import type { NotifyLevel } from '$lib/types';
import type { LayoutServerLoad } from './$types';
import { errMsg } from '$lib/api';

// shape when Teams is not connected / errored (must match the connected return below)
const empty = (configured: boolean, connected: boolean, error: string | null) => ({
	configured, connected, error,
	chats: [] as Awaited<ReturnType<typeof cachedChats>>, teams: [] as Awaited<ReturnType<typeof listTeams>>, favs: [] as string[],
	channelLast: {} as Record<string, string>, unreadChannelIds: [] as string[],
	unreadChannels: [] as { id: string; teamId: string; title: string; at: string }[],
	presence: {} as Record<string, string>, myPresence: 'Available', chatOrder: [] as string[],
	notify: {} as Record<string, NotifyLevel>, mentions: 0, threads: 0, me: null as Awaited<ReturnType<typeof me>> | null
});

export const load: LayoutServerLoad = async ({ params }) => {
	const configured = teamsConfigured();
	const connected = configured && teamsConnected();
	if (!connected) return empty(configured, connected, null);
	try {
		const openChat = params.chat ? decodeURIComponent(params.chat) : null;
		if (openChat) markChatSeenLocal(openChat); // before the list is built, so the open chat never shows as new
		const [my, chatsRaw, teamsRaw] = await Promise.all([me(), cachedChats(), listTeams().catch(() => [])]);
		const chats = chatsRaw.map((c) => (c.id === openChat ? { ...c, unread: false } : c));
		const teams = applyTeamOrder(teamsRaw);
		const favs = favorites();
		const st = teamsStatus();
		const cur = params.channel ? decodeURIComponent(params.channel) : null;
		if (cur) markChannelSeen(cur);
		const unreadChannelIds = st.unreadChannels.filter((c) => c.id !== cur).map((c) => c.id);
		const unreadChannels = st.unreadChannels.filter((c) => c.id !== cur && c.level !== 'off');
		return { configured, connected, chats, teams, favs, channelLast: st.channelLast, unreadChannelIds, unreadChannels, presence: st.presence, myPresence: st.myPresence ?? 'Available', chatOrder: chatOrder(), notify: notifyPrefs(), mentions: activityUnseen('mention'), threads: activityUnseen('thread'), me: my, error: st.presenceError ?? null };
	} catch (e) {
		return empty(configured, connected, errMsg(e));
	}
};
