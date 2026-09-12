import { error } from '@sveltejs/kit';
import { setNotifyPref, NOTIFY_LEVELS } from '$lib/server/teams';
import { need, noContent, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { id, level } = await readBody(request);
	const lv = NOTIFY_LEVELS.find((l) => l === level);
	if (!lv) error(400, 'bad level');
	setNotifyPref(need(id, 'id'), lv);
	return noContent();
};
