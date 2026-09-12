// Local preferences persisted in `meta`: notify levels, favorites, ordering, seen markers, followed threads.
import { meta } from '../db';
import { NOTIFY_LEVELS, isChannelId, defaultNotifyLevel, type NotifyLevel } from '$lib/types';

// ---- per-chat/channel notification level (local): all (banner+bubble+bold) | quiet (bubble+bold) | off (bold only)
const defaultLevel = defaultNotifyLevel;
export { NOTIFY_LEVELS, isChannelId };
export type { NotifyLevel };
export const notifyPrefs = () => meta.json<Record<string, NotifyLevel>>('teams_notify', {});
export function setNotifyPref(id: string, level: NotifyLevel) {
	const all = notifyPrefs();
	if (level === defaultLevel(id)) delete all[id]; else all[id] = level;
	meta.setJson('teams_notify', all);
}
export const levelOf = (id: string, prefs = notifyPrefs()): NotifyLevel => prefs[id] ?? defaultLevel(id);

// ---- favorites (local)
export const favorites = () => meta.json<string[]>('teams_favs', []);
export function setFavorite(id: string, on: boolean) {
	const cur = new Set(favorites());
	on ? cur.add(id) : cur.delete(id);
	meta.setJson('teams_favs', [...cur]);
}

export const lastSeenChannel: Record<string, string> = meta.json('teams_channel_seen', {});
// only forward, and only when it moves (each call rewrites the whole map in SQLite)
export const setChannelSeen = (id: string, at: string) => {
	const prev = lastSeenChannel[id];
	if (prev && at <= prev) return;
	lastSeenChannel[id] = at;
	meta.setJson('teams_channel_seen', lastSeenChannel);
};

// ---- manual ordering (local). favorites order = teams_favs array order; chats order = teams_chat_order
const orderKey = (k: 'chat' | 'team' | 'channel') => `teams_${k}_order`;
export const chatOrder = () => meta.json<string[]>(orderKey('chat'), []);
export const teamOrder = () => meta.json<string[]>(orderKey('team'), []);
export const channelOrder = () => meta.json<Record<string, string[]>>(orderKey('channel'), {});
// kind: favs | chats | teams | channels:<teamId>
export function setOrder(kind: string, ids: string[]) {
	if (kind === 'favs') {
		const keep = new Set(favorites());
		meta.setJson('teams_favs', [...ids.filter((i) => keep.has(i)), ...[...keep].filter((i) => !ids.includes(i))]);
	} else if (kind === 'chats') meta.setJson(orderKey('chat'), ids);
	else if (kind === 'teams') meta.setJson(orderKey('team'), ids);
	else if (kind.startsWith('channels:')) {
		const all = channelOrder();
		all[kind.slice(9)] = ids;
		meta.setJson(orderKey('channel'), all);
	}
}

// threads I follow: posted in / replied / mentioned. thread id -> last reply time seen
export const followed: Record<string, string> = meta.json('teams_followed', {});
// Saved only when something changed (it was rewritten every sweep), and threads quiet for 30 days are
// dropped — the map only ever grew.
let followedSaved = JSON.stringify(followed);
export function saveFollowed() {
	const cut = new Date(Date.now() - 30 * 86400_000).toISOString();
	for (const [id, at] of Object.entries(followed)) if (at < cut) delete followed[id];
	const now = JSON.stringify(followed);
	if (now === followedSaved) return;
	meta.setJson('teams_followed', followed);
	followedSaved = now;
}
