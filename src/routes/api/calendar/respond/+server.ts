import { error } from '@sveltejs/kit';
import { respondEvent } from '$lib/server/teams';
import { upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const { id, action, comment } = await readBody(request);
	const ACTIONS = ['accept', 'decline', 'tentativelyAccept'] as const;
	const act = ACTIONS.find((a) => a === action);
	if (typeof id !== 'string' || !act) error(400, 'bad request');
	return upstream(() => respondEvent(id, act, typeof comment === 'string' ? comment : ''));
};
