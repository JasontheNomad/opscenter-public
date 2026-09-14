import { error } from '@sveltejs/kit';
import { sharedItems } from '$lib/server/teams';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ url }) => {
	const chat = url.searchParams.get('chat'), team = url.searchParams.get('team'), channel = url.searchParams.get('channel');
	if (!chat && !(team && channel)) error(400, 'chat or team+channel required');
	return upstream(() => sharedItems(chat ? { chat } : { team: team!, channel: channel! }));
};
