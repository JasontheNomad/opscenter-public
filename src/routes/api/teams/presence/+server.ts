import { error } from '@sveltejs/kit';
import { setMyPresence, setPresenceSetting, presenceKeepAlive, presenceClear, PREFERRED_ACTIVITY } from '$lib/server/teams';
import { upstream, readBody } from '$lib/server/http';
import { errMsg } from '$lib/api';
import type { RequestHandler } from './$types';

// Two ways to set presence: the delegated "preferred" one, and the app-only session that keeps you shown
// as set while the Teams client is closed. Succeeds if either took; if both failed, says so — this used
// to answer 204 regardless, and the status select showed a status that was never set.
export const POST: RequestHandler = async ({ request }) => {
	const { availability } = await readBody(request).catch(() => ({}) as Record<string, unknown>);
	// own keys only: `in` also accepted 'constructor', which then failed every keep-alive
	if (typeof availability !== 'string' || !Object.hasOwn(PREFERRED_ACTIVITY, availability)) error(400, 'bad availability');
	return upstream(async () => {
		setPresenceSetting(availability);
		const preferred = await setMyPresence(availability, PREFERRED_ACTIVITY[availability]).then(() => null, (e: unknown) => errMsg(e));
		const session = availability === 'Offline' ? (await presenceClear(), true) : await presenceKeepAlive();
		if (preferred !== null && !session) throw new Error(`status not set — ${preferred}`);
	});
};
