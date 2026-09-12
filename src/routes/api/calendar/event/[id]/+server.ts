import { error } from '@sveltejs/kit';
import { upstream, readBody } from '$lib/server/http';
import { isEmail } from '$lib/types';
import { cancelMeeting, getMeeting, updateMeeting } from '$lib/server/teams';
import type { RequestHandler } from './$types';

// `id` = one occurrence (edit this event) or the series master (edit every event)
export const GET: RequestHandler = ({ params }) => upstream(() => getMeeting(params.id));

const zoned = (v: unknown) =>
	v && typeof v === 'object' && typeof (v as { dateTime?: unknown }).dateTime === 'string' && typeof (v as { timeZone?: unknown }).timeZone === 'string'
		? { dateTime: (v as { dateTime: string }).dateTime, timeZone: (v as { timeZone: string }).timeZone }
		: undefined;

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { subject, attendees, location, body, start, end } = await readBody(request);
	if (typeof subject !== 'string' || !subject.trim()) error(400, 'subject required');
	const list = (Array.isArray(attendees) ? attendees : []).filter(isEmail);
	return upstream(() =>
		updateMeeting(params.id, {
			subject: subject.trim(), attendees: list, location: typeof location === 'string' ? location.trim() : '',
			body: typeof body === 'string' ? body : undefined, start: zoned(start), end: zoned(end)
		})
	);
};

// cancel the meeting; body `{ comment }` goes to attendees in the cancellation email
export const DELETE: RequestHandler = async ({ params, request }) => {
	const { comment } = await readBody(request).catch(() => ({}) as Record<string, unknown>);
	return upstream(() => cancelMeeting(params.id, typeof comment === 'string' ? comment.trim() : ''));
};
