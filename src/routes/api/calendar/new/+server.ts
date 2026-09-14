import { error } from '@sveltejs/kit';
import { upstream, readBody } from '$lib/server/http';
import { isEmail } from '$lib/types';
import { createMeeting } from '$lib/server/teams';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { subject, start, end, attendees, optional, location, body, online, allDay, showAs, timeZone } = await readBody(request);
	if (typeof subject !== 'string' || !subject.trim() || typeof start !== 'string' || typeof end !== 'string') error(400, 'subject/start/end required');
	// all day: start/end are YYYY-MM-DD, both days included, in the browser's zone
	const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
	if (allDay === true && (!isDay(start) || !isDay(end) || end < start || typeof timeZone !== 'string' || !timeZone)) error(400, 'all day needs start/end dates and a timeZone');
	const list = (Array.isArray(attendees) ? attendees : String(attendees ?? '').split(/[\s,;]+/)).filter(isEmail);
	const optionalList = (Array.isArray(optional) ? optional : []).filter(isEmail);
	return upstream(async () => {
		const ev = await createMeeting({ subject: subject.trim(), startISO: start, endISO: end, attendees: list, optional: optionalList, location: typeof location === 'string' ? location.trim() : '', body: typeof body === 'string' ? body : '', online: online !== false,
			...(allDay === true ? { allDay: { start, end, timeZone: timeZone as string } } : {}), showAs: showAs === 'oof' ? 'oof' : 'busy' });
		return { id: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null };
	}, 201);
};
