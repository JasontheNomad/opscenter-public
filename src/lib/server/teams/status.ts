// App-wide status singleton (unread, presence, errors), SSE fan-out, mentions/threads activity.
import { meta } from '../db';
import { nowIso } from '$lib/dates';
import { type NotifyLevel } from '$lib/types';
import { ACTIVITY_CAP } from './shared';
import { onLogout } from './auth';
import { lastSeenChannel, setChannelSeen } from './prefs';

// ---- live events (SSE): clients refresh immediately when the poller sees something new
type Listener = (event: string, data: unknown) => void;
const listeners = new Set<Listener>();
export const onTeamsEvent = (fn: Listener) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (event: string, data: unknown = {}) => { for (const fn of listeners) try { fn(event, data); } catch {} };

// ---- mentions + followed threads (persisted in meta)
export type Activity = { id: string; kind: 'mention' | 'thread'; at: string; by: string; preview: string; where: string; href: string; seen: boolean };
let activity: Activity[] = meta.json('teams_activity', []);
const saveActivity = () => meta.setJson('teams_activity', activity.slice(0, ACTIVITY_CAP));
export const activityList = (kind: Activity['kind']) => activity.filter((a) => a.kind === kind);
export const activityUnseen = (kind: Activity['kind']) => activity.filter((a) => a.kind === kind && !a.seen).length;
export function markActivitySeen(kind: Activity['kind'], id?: string) {
	for (const a of activity) if (a.kind === kind && (!id || a.id === id)) a.seen = true;
	saveActivity();
	emit('status');
}
export function addActivity(a: Omit<Activity, 'seen'>) {
	if (activity.some((x) => x.id === a.id)) return;
	activity = [{ ...a, seen: false }, ...activity].slice(0, ACTIVITY_CAP);
	saveActivity();
	emit('status');
}

// ---- background poller: unread chat count available app-wide (sidebar badge), regardless of page
export type TeamsStatus = {
	unread: number; // bubble count (chats + channels, excluding muted)
	unreadChats: { id: string; title: string; at: string; level: NotifyLevel }[];
	unreadChannels: { id: string; teamId: string; title: string; at: string; level: NotifyLevel }[];
	channelLast: Record<string, string>;
	presence: Record<string, string>; // userId -> availability
	myPresence?: string; presenceError?: string | null;
	mentions?: number; threads?: number;
	at: string | null; error: string | null;
};
const EMPTY_STATUS: TeamsStatus = { unread: 0, unreadChats: [], unreadChannels: [], channelLast: {}, presence: {}, at: null, error: null };
// mutable singleton read by every route + the poller; reassign via S.status
export const S = { status: { ...EMPTY_STATUS } as TeamsStatus };
// mention/thread counts are read live: addActivity emits `status` the moment one lands, and a snapshot
// taken later in the poller tick meant the client re-read an old count
export const teamsStatus = (): TeamsStatus => ({ ...S.status, mentions: activityUnseen('mention'), threads: activityUnseen('thread') });
const resetStatus = () => { S.status = { ...EMPTY_STATUS }; emit('status'); };
// nav bubble = unread chats + channels that aren't muted
export const recount = (chats = S.status.unreadChats, channels = S.status.unreadChannels) =>
	chats.filter((c) => c.level !== 'off').length + channels.filter((c) => c.level !== 'off').length;

export function markChannelSeen(id: string) {
	// An open channel reports "seen now" every 10 s. Moving the mark by under a minute isn't worth a
	// rewrite — a post arriving meanwhile gets its own exact mark from the sweep (viewingChannel).
	const prev = lastSeenChannel[id];
	if (!prev || Date.now() - Date.parse(prev) >= 60_000) setChannelSeen(id, nowIso());
	if (!S.status.unreadChannels.some((x) => x.id === id)) return;
	const unreadChannels = S.status.unreadChannels.filter((x) => x.id !== id);
	S.status = { ...S.status, unreadChannels, unread: recount(S.status.unreadChats, unreadChannels) };
	emit('status');
}

onLogout(resetStatus);
