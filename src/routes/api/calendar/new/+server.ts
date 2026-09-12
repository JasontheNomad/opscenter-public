import { error } from '@sveltejs/kit';
import { upstream, readBody } from '$lib/server/http';
import { isEmail } from '$lib/types';
import { createMeeting } from '$lib/server/teams';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { subject, start, end, attendees, location, body, online } = await readBody(request);
	if (typeof subject !== 'string' || !subject.trim() || typeof start !== 'string' || typeof end !== 'string') error(400, 'subject/start/end required');
	const list = (Array.isArray(attendees) ? attendees : String(attendees ?? '').split(/[\s,;]+/)).filter(isEmail);
	return upstream(async () => {
		const ev = await createMeeting({ subject: subject.trim(), startISO: start, endISO: end, attendees: list, location: typeof location === 'string' ? location.trim() : '', body: typeof body === 'string' ? body : '', online: online !== false });
		return { id: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null };
	}, 201);
};
