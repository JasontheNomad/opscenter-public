// Background poller: chat list, open-chat refresh, channel sweep, presence keep-alive, PWA focus reports.
import { nowIso } from '$lib/dates';
import { DEMO, demoChats, demoPresence } from '../demo';
import { isChannelId } from '$lib/types';
import { BEAT_MS, MIN, chunk, isPost } from './shared';
import { teamsConfigured, teamsConnected } from './auth';
import { graph, me } from './graph';
import { toMsg, type RawMsg } from './render';
import { favorites, followed, lastSeenChannel, levelOf, notifyPrefs, saveFollowed, setChannelSeen } from './prefs';
import { focusedChannels, focusedChats, isFocused, openChannels, setFocus, viewingChannel, viewingChat } from './focus';
import { S, addActivity, emit, markChannelSeen, recount, type TeamsStatus } from './status';
import { chatList, chatMessages, forgetChannel, listChats, markChatRead, markChatSeenLocal, msgCache, refreshChannel, userPhoto, type ChatSummary } from './messages';
import { listTeams, type Channel, type Team } from './teams';
import { warmCalendar } from './calendar';
import { myPresenceSetting, presenceFor, presenceKeepAlive, presenceSessionError } from './presence';
import { errMsg } from '$lib/api';

/** A window's report (every 10 s, and on focus/blur/navigation). `client` = that window's own id. */
export function reportFocus(client: string, f: { focused: boolean; chat?: string | null; channel?: string | null; notify?: boolean }) {
	const r = { focused: !!f.focused, chat: f.chat ?? null, channel: f.channel ?? null, notify: !!f.notify };
	setFocus(client, r);
	if (r.focused && r.chat) markChatSeenLocal(r.chat);
	if (r.focused && r.channel) markChannelSeen(r.channel);
}
const notified = new Map<string, string>(); // chat/channel id -> last message time we alerted for
const markedRead = new Map<string, string>(); // chat id -> last message id we told Graph we read
// log a recurring failure once per distinct message, not every sweep
const warned = new Map<string, string>();
const warnOnce = (key: string, msg: string) => {
	if (warned.get(key) === msg) return;
	warned.set(key, msg);
	console.warn(msg);
};

let pollerStarted = false;

export function startTeamsPoller() {
	if (pollerStarted) return;
	pollerStarted = true;
	if (DEMO()) {
		S.status = { ...S.status, unread: 2, unreadChats: demoChats.filter((c) => c.unread).map((c) => ({ id: c.id, title: c.topic ?? c.people[1]?.name ?? '', at: c.last?.at ?? '', level: 'all' })), unreadChannels: [{ id: 'ch-alerts', teamId: 't-cs', title: 'Workflow Alerts · Customer Success', at: nowIso(), level: 'quiet' }], presence: demoPresence, myPresence: 'Available', at: nowIso(), error: null };
		S.status.unread = 3;
		return;
	}
	const tick = async () => {
		if (!teamsConfigured() || !teamsConnected()) return;
		try {
			const my = await me();
			const chats = await listChats();
			chatList.at = Date.now(); chatList.v = chats;
			const prefs = notifyPrefs();
			for (const c of chats) if (c.unread && viewingChat(c.id)) { c.unread = false; markChatSeenLocal(c.id); void markChatRead(c.id, my.id); }
			const unread = chats.filter((c) => c.unread);
			const titleOf = (c: ChatSummary) => c.topic ?? c.members.filter((m) => m !== my.displayName).join(', ');
			// new unread chat messages (not ours): refresh that chat's messages and push a live event
			let changed = false;
			for (const c of unread) {
				const at = c.last?.at ?? '';
				if (!at || notified.get(c.id) === at) continue;
				notified.set(c.id, at);
				changed = true;
				try {
					const v = await chatMessages(c.id, my.id);
					msgCache.set(c.id, { at: Date.now(), v });
					for (const m of v.slice(-5)) if (m.mentionsMe && !m.me) addActivity({ id: `m-${m.id}`, kind: 'mention', at: m.at, by: m.from, preview: m.text, where: titleOf(c), href: `/teams/${encodeURIComponent(c.id)}` });
				} catch {}
			}
			// status first, then the event: the client answers `chats` by re-reading status at once, and
			// used to get the old unread list — so the PWA banner waited for the 20 s poll
			// read the flags now, not the `unread` list from before the awaits: a chat opened meanwhile was
			// cleared on these same objects (markChatSeenLocal), and writing the old list brought its badge back
			const unreadChats = chats.filter((c) => c.unread).slice(0, 20).map((c) => ({ id: c.id, title: titleOf(c), at: c.last?.at ?? '', level: levelOf(c.id, prefs) }));
			S.status = { ...S.status, unread: recount(unreadChats), unreadChats, at: nowIso(), error: null };
			if (changed) emit('chats');
			// forget alerts for chats that are no longer unread (map would otherwise grow forever)
			for (const id of notified.keys()) if (!isChannelId(id) && !unread.some((c) => c.id === id)) notified.delete(id);
			// presence of everyone in recent 1:1/group chats
			const ids = [...new Set(chats.flatMap((c) => c.memberIds))].filter((id) => id !== my.id).slice(0, 100);
			S.status.presence = await presenceFor(ids);
			S.status.myPresence = myPresenceSetting();
			S.status.presenceError = presenceSessionError;
			await warmHotChats(chats, unread, my.id);
			await warmPhotos(chats, my.id);
		} catch (e) {
			S.status = { ...S.status, error: errMsg(e).slice(0, 200) };
		}
	};
	// warm message cache: favorites + 8 most recent (unread first), only if the chat changed since cached
	const warmHotChats = async (chats: ChatSummary[], unread: ChatSummary[], myId: string) => {
		const favs = new Set(favorites());
		const hot = [...unread, ...chats.filter((c) => favs.has(c.id)), ...chats.slice(0, 8)]
			.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i)
			.slice(0, 14);
		for (const c of hot) {
			const cached = msgCache.get(c.id);
			const lastAt = c.last?.at ?? '';
			const latestCached = cached?.v[cached.v.length - 1]?.at ?? '';
			if (cached && latestCached >= lastAt && Date.now() - cached.at < 10 * MIN) { cached.at = Date.now(); continue; }
			try { msgCache.set(c.id, { at: Date.now(), v: await chatMessages(c.id, myId) }); } catch {}
		}
	};
	// Avatars for the chat list. The browser fetches one <img> per row, and a photo the user doesn't
	// have costs a full Graph round-trip, so a cold cache stalls the list visibly. Fill it here, off
	// the user's path. userPhoto() returns from cache once warm, so repeat ticks are free.
	const warmPhotos = async (chats: ChatSummary[], myId: string) => {
		const ids = [...new Set(chats.flatMap((c) => c.people.filter((p) => p.id !== myId).slice(0, 2).map((p) => p.id)))];
		// a few at a time: the whole point is to stay well under the Graph rate limit while nobody waits
		for (const group of chunk(ids, 5)) await Promise.all(group.map((id) => userPhoto(id).catch(() => {})));
	};
	// mentions + followed threads over a channel's last few posts and their replies
	const scanChannelActivity = (t: Team, ch: Channel, posts: RawMsg[], myId: string) => {
		const where = `${ch.name} · ${t.name}`;
		for (const post of posts) {
			if (!isPost(post)) continue;
			const pm = toMsg(post, myId);
			const href = `/teams/channel/${encodeURIComponent(t.id)}/${encodeURIComponent(ch.id)}?thread=${encodeURIComponent(post.id)}`;
			const all = [pm, ...(pm.replies ?? [])];
			for (const x of all) if (x.mentionsMe && !x.me) addActivity({ id: `m-${x.id}`, kind: 'mention', at: x.at, by: x.from, preview: x.text, where, href });
			if (all.some((x) => x.me || x.mentionsMe)) {
				const last = pm.replies?.at(-1);
				const prev = followed[post.id];
				if (last && !last.me && prev && last.at > prev) addActivity({ id: `t-${last.id}`, kind: 'thread', at: last.at, by: last.from, preview: last.text, where, href });
				followed[post.id] = last?.at ?? pm.at;
			}
		}
	};
	let n = 0;
	// refresh just the open conversation (cheap single call) so the active chat feels live
	const refreshOpen = async () => {
		if (!isFocused()) return;
		try {
			const my = await me();
			for (const chat of focusedChats()) {
				const before = msgCache.get(chat)?.v.at(-1)?.id;
				const v = await chatMessages(chat, my.id);
				msgCache.set(chat, { at: Date.now(), v });
				const last = v.at(-1)?.id ?? '';
				if (last !== before) emit('chats');
				// tell Graph "read" when there's something new to have read — not every 5 s while it's open
				if (markedRead.get(chat) !== last) (markedRead.set(chat, last), void markChatRead(chat, my.id));
			}
			const open = focusedChannels();
			if (open.length) {
				const teams = await listTeams(); // cached 10 min
				for (const id of open) {
					const team = teams.find((t) => t.channels.some((c) => c.id === id));
					if (team && (await refreshChannel(team.id, id, my.id))) emit('channels', { id });
				}
			}
		} catch {}
	};
	const channelSweep = async (onlyStarred = false) => {
		if (!teamsConfigured() || !teamsConnected()) return;
		try {
			const my = await me();
			const teams = await listTeams();
			const last: Record<string, string> = { ...S.status.channelLast };
			const unreadCh: TeamsStatus['unreadChannels'] = [];
			const swept = new Set<string>();
			const fresh: string[] = []; // channels with a new post: announced once status holds them (see tick)
			const prefs = notifyPrefs();
			const favs = new Set(favorites());
			const open = openChannels();
			const todo = teams.flatMap((t) => t.channels.filter((ch) => !onlyStarred || favs.has(ch.id) || open.has(ch.id)).map((ch) => ({ t, ch })));
			const sweepOne = async ({ t, ch }: (typeof todo)[number]) => {
				swept.add(ch.id);
				try {
					const r = await graph<{ value: RawMsg[] }>(`/teams/${t.id}/channels/${ch.id}/messages?$top=5&$expand=replies`);
					// newest real post: skip system events (member added…) and deleted posts, which have no from.user
					const m = r.value.find(isPost);
					if (!m) return;
					scanChannelActivity(t, ch, r.value, my.id);
					last[ch.id] = m.createdDateTime;
					// first time we see a channel: baseline it as read so only future posts count
					if (!(ch.id in lastSeenChannel)) setChannelSeen(ch.id, m.createdDateTime);
					const seen = lastSeenChannel[ch.id] ?? '';
					if (viewingChannel(ch.id) && m.createdDateTime > seen) { setChannelSeen(ch.id, m.createdDateTime); return; }
					if (m.createdDateTime > seen && m.from?.user?.id !== my.id) {
						const level = levelOf(ch.id, prefs);
						unreadCh.push({ id: ch.id, teamId: t.id, title: `${ch.name} · ${t.name}`, at: m.createdDateTime, level });
						if (S.status.at && notified.get(ch.id) !== m.createdDateTime) {
							notified.set(ch.id, m.createdDateTime);
							fresh.push(ch.id);
						} else notified.set(ch.id, m.createdDateTime);
					}
				} catch (e) {
					// keep what we knew: a blip (429, timeout) used to wipe this channel's unread badge until
					// the next good sweep. 403 = a channel we can't read, which is normal and not logged.
					const prev = S.status.unreadChannels.find((c) => c.id === ch.id);
					if (prev) unreadCh.push(prev);
					const msg = errMsg(e);
					if (!/Graph 403/.test(msg)) warnOnce(`channel:${ch.id}`, `[teams] channel sweep: ${ch.name}: ${msg.slice(0, 160)}`);
				}
			};
			// four at a time: one Graph call per channel, and in series a large tenant took long enough that
			// the rest of the poller waited on it
			for (const group of chunk(todo, 4)) await Promise.all(group.map(sweepOne));
			saveFollowed();
			// starred-only sweep: keep the unread state of channels we didn't look at this time
			// and drop channels opened while the sweep ran — their seen time is now past the post we fetched
			const merged = (onlyStarred ? [...S.status.unreadChannels.filter((c) => !swept.has(c.id)), ...unreadCh] : unreadCh).filter(
				(c) => !(lastSeenChannel[c.id] && lastSeenChannel[c.id] >= c.at)
			);
			const sorted = merged.sort((a, b) => b.at.localeCompare(a.at));
			S.status = { ...S.status, channelLast: last, unreadChannels: sorted, unread: recount(S.status.unreadChats, sorted) };
			for (const id of fresh) (forgetChannel(id), emit('channels', { id }));
		} catch (e) {
			warnOnce('sweep', `[teams] channel sweep failed: ${errMsg(e).slice(0, 200)}`);
		}
	};
	let sweeping = false;
	const sweep = (onlyStarred: boolean) => {
		if (sweeping) return;
		sweeping = true;
		void channelSweep(onlyStarred).finally(() => (sweeping = false));
	};
	// base beat = 5s. chat list: every 10s focused / 20s idle. open chat: every 5s.
	// starred channels: every 10s. all channels: every 60s. presence keep-alive: every 5 min.
	let running = false;
	const loop = async () => {
		if (running) return; // a slow sweep (Graph 429s) must not stack concurrent ticks
		running = true;
		const beat = n++;
		try {
			const f = isFocused();
			const every = (ms: number) => beat % (ms / BEAT_MS) === 0;
			if (every(f ? 10_000 : 20_000)) await tick();
			if (f) await refreshOpen();
			// the sweep runs beside the beat, under its own guard: awaited here, a slow one (many channels, a
			// 429) held up the open chat's 5 s refresh until it finished
			if (every(MIN)) sweep(false);
			else if (every(10_000)) sweep(true);
			if (every(5 * MIN)) await presenceKeepAlive().catch(() => {});
			if (every(MIN)) await warmCalendar();
		} catch (e) {
			// the jobs catch their own Graph errors; anything reaching here (a DB error in teamsConnected, a
			// bug) would otherwise be an unhandled rejection, and Node exits on those
			console.error('[teams] poller tick failed:', e);
		} finally {
			running = false;
		}
	};
	void loop();
	setInterval(loop, BEAT_MS);
}
