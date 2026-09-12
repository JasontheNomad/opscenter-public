// What the open windows are looking at (each PWA window reports every 10 s); gates banners and auto-read.
// One report per window: with a single shared record, the Mac's idle window and the Arch one being read
// overwrote each other every 10 s, so the open-chat refresh and auto-read flickered off.
import { FOCUS_TTL_MS } from './shared';

type Report = { at: number; focused: boolean; chat: string | null; channel: string | null; notify: boolean };
const reports = new Map<string, Report>();
const fresh = () => {
	const now = Date.now();
	return [...reports.values()].filter((r) => now - r.at < FOCUS_TTL_MS);
};

export function setFocus(client: string, r: Omit<Report, 'at'>) {
	const now = Date.now();
	for (const [k, v] of reports) if (now - v.at > FOCUS_TTL_MS) reports.delete(k); // closed windows
	reports.set(client, { ...r, at: now });
}

export const isFocused = () => fresh().some((r) => r.focused);
export const viewingChat = (id: string) => fresh().some((r) => r.focused && r.chat === id);
export const viewingChannel = (id: string) => fresh().some((r) => r.focused && r.channel === id);
/** Chats / channels open in a focused window — the poller refreshes these every beat. */
export const focusedChats = () => [...new Set(fresh().flatMap((r) => (r.focused && r.chat ? [r.chat] : [])))];
export const focusedChannels = () => [...new Set(fresh().flatMap((r) => (r.focused && r.channel ? [r.channel] : [])))];
/** Channels open in any window, focused or not — kept in the starred sweep. */
export const openChannels = () => new Set(fresh().flatMap((r) => (r.channel ? [r.channel] : [])));
