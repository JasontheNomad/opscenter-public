import { teamsConfigured, teamsConnected, calendarWeek } from '$lib/server/teams';
import { weekOf } from '$lib/dates';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/api';

// week = Sunday..Saturday containing ?d=YYYY-MM-DD (local date), fetched in UTC; served from the week cache
export const load: PageServerLoad = async ({ url, depends }) => {
	depends('app:calendar');
	const configured = teamsConfigured();
	const connected = configured && teamsConnected();
	const d = url.searchParams.get('d');
	const week = weekOf(d);
	if (!connected) return { configured, connected, events: [], weekStart: week.start, error: null };
	// ‹ / › are the next clicks: have those weeks ready by then
	for (const offset of [-1, 1]) void calendarWeek(weekOf(d, offset)).catch(() => {});
	try {
		return { configured, connected, events: await calendarWeek(week), weekStart: week.start, error: null };
	} catch (e) {
		return { configured, connected, events: [], weekStart: week.start, error: errMsg(e) };
	}
};
