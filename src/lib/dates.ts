// local-calendar date as YYYY-MM-DD (never toISOString().slice(0,10) — that's UTC and flips after 5 pm PDT)
export const nowIso = () => new Date().toISOString();
export const ymd = (d: Date = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Sunday 00:00 → next Sunday, local time (the process TZ — the VPS unit pins America/Phoenix), around `d` (YYYY-MM-DD) or today, `offset` weeks away. */
export function weekOf(d: string | null, offset = 0): { start: string; end: string } {
	const anchor = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date();
	const start = new Date(anchor);
	start.setDate(anchor.getDate() - anchor.getDay() + offset * 7);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(start.getDate() + 7);
	return { start: start.toISOString(), end: end.toISOString() };
}

/** Is timestamp `a` later than `b` (null = never)? By time, not text: HubSpot's search and object APIs format
 * the same instant differently (`…00Z` vs `…00.000Z`), and string order gets those wrong. */
export const newer = (a: string | null, b: string | null) => !!a && (!b || Date.parse(a) > Date.parse(b));
