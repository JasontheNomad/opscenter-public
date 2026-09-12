// Calendar (calendarView), meetings, people search.
import { nowIso, weekOf } from '$lib/dates';
import { htmlToText, textToHtml } from '$lib/html';
import { DEMO, demoEvents } from '../demo';
import { graph } from './graph';
import { onLogout, teamsConfigured, teamsConnected } from './auth';

// ---- calendar (Graph calendarView), times returned as UTC ISO
export type CalEvent = {
	id: string; subject: string; start: string; end: string; allDay: boolean;
	organizer: string; organizerId: string | null; attendees: number; response: string; isOrganizer: boolean;
	joinUrl: string | null; webLink: string; location: string; preview: string; cancelled: boolean; recurring: boolean;
	seriesId?: string | null;
};

export async function calendarView(startISO: string, endISO: string): Promise<CalEvent[]> {
	if (DEMO()) return demoEvents.filter((e) => e.start >= startISO && e.start < endISO);
	type Raw = {
		id: string; subject: string; isAllDay: boolean; isCancelled: boolean; isOrganizer: boolean; webLink: string; bodyPreview: string;
		start: { dateTime: string }; end: { dateTime: string };
		organizer?: { emailAddress?: { name?: string; address?: string } };
		attendees?: { emailAddress?: { address?: string } }[];
		responseStatus?: { response?: string };
		onlineMeeting?: { joinUrl?: string } | null; onlineMeetingUrl?: string | null;
		location?: { displayName?: string }; seriesMasterId?: string | null;
	};
	const q = new URLSearchParams({ startDateTime: startISO, endDateTime: endISO, $top: '100', $orderby: 'start/dateTime',
		$select: 'id,subject,isAllDay,isCancelled,isOrganizer,webLink,bodyPreview,start,end,organizer,attendees,responseStatus,onlineMeeting,onlineMeetingUrl,location,seriesMasterId' });
	// a busy week can pass one page; follow nextLink (capped) rather than silently drop the rest
	const rows: Raw[] = [];
	let url: string | null = `/me/calendarView?${q}`;
	for (let page = 0; url && page < 10; page++) {
		const r: { value: Raw[]; '@odata.nextLink'?: string } = await graph(url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
		rows.push(...r.value);
		url = r['@odata.nextLink'] ?? null;
	}
	return rows.map((e) => ({
		id: e.id, subject: e.subject || '(no title)', allDay: e.isAllDay,
		start: e.start.dateTime.replace(/(\.\d+)?$/, 'Z'), end: e.end.dateTime.replace(/(\.\d+)?$/, 'Z'),
		organizer: e.organizer?.emailAddress?.name ?? '', organizerId: null,
		attendees: e.attendees?.length ?? 0, response: e.responseStatus?.response ?? 'none', isOrganizer: e.isOrganizer,
		joinUrl: e.onlineMeeting?.joinUrl ?? e.onlineMeetingUrl ?? null, webLink: e.webLink,
		location: e.location?.displayName ?? '', preview: (e.bodyPreview ?? '').slice(0, 300), cancelled: e.isCancelled, recurring: !!e.seriesMasterId,
		seriesId: e.seriesMasterId ?? null
	}));
}

// ---- weeks, cached. Every calendar load (and its 60 s refresh) used to wait ~300 ms on Graph. Now the
// poller keeps last/this/next week warm, viewing a week pre-fetches its neighbours, and any change made
// from here clears the lot. Worst case a change made in Outlook shows up to ~90 s late — the page's own
// refresh was 60 s anyway.
const WEEK_FRESH_MS = 90_000;
const weeks = new Map<string, { at: number; v: Promise<CalEvent[]> }>();

/** A week's events from cache when fresher than `maxAge`; concurrent callers share one Graph request. */
export function calendarWeek({ start, end }: { start: string; end: string }, maxAge = WEEK_FRESH_MS): Promise<CalEvent[]> {
	const key = `${start}|${end}`;
	const hit = weeks.get(key);
	if (hit && Date.now() - hit.at < maxAge) return hit.v;
	const v = calendarView(start, end);
	weeks.set(key, { at: Date.now(), v });
	v.catch(() => weeks.get(key)?.v === v && weeks.delete(key)); // never serve a failure from cache
	for (const [k, c] of weeks) if (Date.now() - c.at > 10 * WEEK_FRESH_MS) weeks.delete(k); // stay small
	return v;
}
const changed = <T>(p: Promise<T>) => p.then((r) => (weeks.clear(), r));
onLogout(() => weeks.clear());

/** Poller, every minute: refresh last, this and next week just before they go stale. */
export async function warmCalendar() {
	if (DEMO() || !teamsConfigured() || !teamsConnected()) return;
	for (const offset of [0, 1, -1]) await calendarWeek(weekOf(null, offset), 55_000).catch(() => {});
}

export const respondEvent = (id: string, action: 'accept' | 'decline' | 'tentativelyAccept', comment = '') =>
	changed(graph<void>(`/me/events/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({ sendResponse: true, comment }) }));

export const meetNow = () =>
	graph<{ joinWebUrl: string }>('/me/onlineMeetings', { method: 'POST', body: JSON.stringify({ subject: 'Meet now', startDateTime: nowIso(), endDateTime: new Date(Date.now() + 3600_000).toISOString() }) });

export const createMeeting = (o: { subject: string; startISO: string; endISO: string; attendees: string[]; location?: string; body?: string; online?: boolean }) =>
	changed(graph<{ id: string; onlineMeeting?: { joinUrl?: string } }>('/me/events', {
		method: 'POST',
		body: JSON.stringify({
			subject: o.subject,
			isOnlineMeeting: o.online !== false, ...(o.online !== false ? { onlineMeetingProvider: 'teamsForBusiness' } : {}),
			start: { dateTime: o.startISO, timeZone: 'UTC' }, end: { dateTime: o.endISO, timeZone: 'UTC' },
			attendees: o.attendees.map((a) => ({ emailAddress: { address: a }, type: 'required' })),
			...(o.location ? { location: { displayName: o.location } } : {}),
			...(o.body ? { body: { contentType: 'text', content: o.body } } : {})
		})
	}));

// ---- edit an existing meeting. `id` is one occurrence (only that event changes) or a series master
// (every event). Only the organizer may edit; Outlook sends the invites/updates itself.
type RawMeeting = {
	subject?: string; isOrganizer: boolean; isOnlineMeeting?: boolean;
	body?: { contentType?: string; content?: string };
	start: { dateTime: string }; end: { dateTime: string };
	location?: { displayName?: string };
	attendees?: { type?: string; emailAddress?: { name?: string; address?: string } }[];
};
const rawMeeting = (id: string) =>
	graph<RawMeeting>(`/me/events/${encodeURIComponent(id)}?$select=subject,isOrganizer,isOnlineMeeting,body,start,end,location,attendees`, { headers: { Prefer: 'outlook.timezone="UTC"' } });
// A Teams meeting's body ends with Microsoft's join block (a line of underscores, then the join link).
// Split it off so editing the details text never deletes the join info from the invite.
function splitJoinBlock(html: string): [string, string] {
	const i = html.indexOf('________________');
	if (i < 0) return [html, ''];
	const d = html.lastIndexOf('<div', i);
	return [html.slice(0, d < 0 ? i : d), html.slice(d < 0 ? i : d)];
}
const detailsText = (html: string) => htmlToText(html.replace(/<head[\s\S]*?<\/head>|<style[\s\S]*?<\/style>/gi, ''));

export async function getMeeting(id: string) {
	const e = await rawMeeting(id);
	const html = e.body?.content ?? '';
	return {
		subject: e.subject ?? '', isOrganizer: e.isOrganizer, online: !!e.isOnlineMeeting,
		start: e.start.dateTime.replace(/(\.\d+)?$/, 'Z'), end: e.end.dateTime.replace(/(\.\d+)?$/, 'Z'),
		location: e.location?.displayName ?? '',
		body: e.body?.contentType === 'html' ? detailsText(splitJoinBlock(html)[0]) : html,
		attendees: (e.attendees ?? []).flatMap((a) => (a.emailAddress?.address ? [{ name: a.emailAddress.name || a.emailAddress.address, mail: a.emailAddress.address }] : []))
	};
}

export async function updateMeeting(id: string, o: { subject: string; attendees: string[]; location: string; body?: string; start?: { dateTime: string; timeZone: string }; end?: { dateTime: string; timeZone: string } }) {
	const cur = await rawMeeting(id);
	if (!cur.isOrganizer) throw new Error('Only the organizer can edit this meeting');
	// keep each existing attendee's type (optional / resource); new ones are required
	const typeOf = new Map((cur.attendees ?? []).map((a) => [a.emailAddress?.address?.toLowerCase(), a.type]));
	const patch: Record<string, unknown> = {
		subject: o.subject,
		location: { displayName: o.location },
		attendees: o.attendees.map((a) => ({ emailAddress: { address: a }, type: typeOf.get(a.toLowerCase()) ?? 'required' }))
	};
	if (o.start && o.end) Object.assign(patch, { start: o.start, end: o.end });
	if (o.body !== undefined) {
		const html = cur.body?.contentType === 'html' ? cur.body.content ?? '' : '';
		patch.body = { contentType: 'html', content: textToHtml(o.body) + splitJoinBlock(html)[1] };
	}
	await changed(graph<unknown>(`/me/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }));
}

// Organizer cancels (occurrence or series master): attendees get Outlook's cancellation carrying `comment`.
// Graph's cancel is for meetings, so an event with nobody invited is simply deleted.
export async function cancelMeeting(id: string, comment: string) {
	const cur = await rawMeeting(id);
	if (!cur.isOrganizer) throw new Error('Only the organizer can cancel this meeting');
	const path = `/me/events/${encodeURIComponent(id)}`;
	if (cur.attendees?.length) await changed(graph<void>(`${path}/cancel`, { method: 'POST', body: JSON.stringify({ comment }) }));
	else await changed(graph<void>(path, { method: 'DELETE' }));
}

// directory people search (User.ReadBasic.All)
export async function searchPeople(q: string): Promise<{ id: string; name: string; mail: string }[]> {
	const safe = q.replace(/'/g, "''");
	// URLSearchParams, not interpolation: an unencoded & or # in the name ("Smith & Sons") truncated the
	// $filter and Graph answered 400.
	const params = new URLSearchParams({
		$filter: `startswith(displayName,'${safe}') or startswith(mail,'${safe}') or startswith(givenName,'${safe}') or startswith(surname,'${safe}')`,
		$select: 'id,displayName,mail,userPrincipalName',
		$top: '8'
	});
	const r = await graph<{ value: { id: string; displayName: string; mail?: string | null; userPrincipalName?: string }[] }>(
		`/users?${params}`
	);
	return r.value.filter((u) => u.mail || u.userPrincipalName).map((u) => ({ id: u.id, name: u.displayName, mail: (u.mail ?? u.userPrincipalName)! }));
}

// people Jason works with, including outside the tenant (People.Read)
export async function searchRelevantPeople(q: string): Promise<{ id: string; name: string; mail: string }[]> {
	const safe = q.replace(/"/g, '');
	const r = await graph<{ value: { id: string; displayName: string; scoredEmailAddresses?: { address?: string }[] }[] }>(
		`/me/people?$search="${encodeURIComponent(safe)}"&$select=id,displayName,scoredEmailAddresses&$top=8`
	);
	return r.value.flatMap((p) => {
		const mail = p.scoredEmailAddresses?.[0]?.address;
		return mail ? [{ id: p.id, name: p.displayName || mail, mail }] : [];
	});
}
