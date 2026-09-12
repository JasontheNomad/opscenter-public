// Per-area font size, set in Settings like a word editor (default 14; the design base is 13) and stored
// server-side (meta `ui_text_size`) so the first paint is already right. Each area's root element
// gets textStyle(); layout.css turns --text-scale into every text size inside it, keeping their
// proportions. Every area sets its own, so they're independent even when nested (the ticket panel
// sits inside a board). Brave's zoom (⌘ +/−) still scales the whole app on top.
export const TEXT_AREAS = [
	{ id: 'sidebar', name: 'Sidebar', hint: 'main navigation', base: 13 },
	{ id: 'projects', name: 'Projects', hint: 'board', base: 13 },
	{ id: 'support', name: 'Support', hint: 'board', base: 13 },
	{ id: 'tasks', name: 'Tasks', hint: 'board', base: 13 },
	{ id: 'panel', name: 'Ticket panel', hint: 'card details, notes, client response', base: 13 },
	{ id: 'clients', name: 'Clients', hint: 'client list, tickets, contacts, history', base: 13 },
	{ id: 'notes', name: 'Client notes', hint: 'notes editor and preview', base: 14 },
	{ id: 'teamsList', name: 'Teams list', hint: 'chats and channels', base: 13 },
	{ id: 'teamsChat', name: 'Teams chat', hint: 'the conversation', base: 13 },
	{ id: 'calendar', name: 'Calendar', hint: 'week view and event details', base: 13 },
	{ id: 'call', name: 'Call window', hint: 'pre-join and call', base: 13 }
] as const;
export type TextArea = (typeof TEXT_AREAS)[number]['id'];
export type TextSizes = Partial<Record<TextArea, number>>;
export const TEXT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 20, 22];
export const DEFAULT_SIZE = 14; // every area, unless changed in Settings
export const isTextArea = (s: unknown): s is TextArea => TEXT_AREAS.some((a) => a.id === s);
const baseSize = (area: TextArea) => TEXT_AREAS.find((a) => a.id === area)!.base;

/** Style for an area's root: its scale, plus the base font-size that unclassed text inherits. */
export function textStyle(sizes: TextSizes | undefined, area: TextArea): string {
	const s = (sizes?.[area] ?? DEFAULT_SIZE) / baseSize(area);
	return `--text-scale: ${s}; font-size: ${+(13 * s).toFixed(2)}px;`;
}
