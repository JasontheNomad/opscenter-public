// Display formatters shared by components (one definition each; previously re-declared per file).
const d = (v: string | Date) => (v instanceof Date ? v : new Date(v));
export const clock = (v: string | Date) => d(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const shortDate = (iso: string) => (iso ? d(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '');
export const shortDateTime = (iso: string) => d(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// "3:41 PM" today, "Sep 4" otherwise (Teams-style)
export const timeOrDate = (iso: string) => {
	const x = d(iso);
	return x.toDateString() === new Date().toDateString() ? clock(x) : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
// Today / Yesterday / Monday / 9/2/26
export const relativeDay = (iso: string) => {
	const x = d(iso), diff = (Date.now() - x.getTime()) / 864e5;
	return diff < 1 ? 'Today' : diff < 2 ? 'Yesterday' : diff < 7 ? x.toLocaleDateString(undefined, { weekday: 'long' }) : x.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
};
export const hourLabel = (h: number) => (h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`);
export const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
export const hue = (n: string) => [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
