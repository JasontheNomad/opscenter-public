// Messages for one chat, for surfaces that aren't a page load — the in-call chat panel.
// Reuses the cache the poller warms, but asks for it fresh: during a call the main window isn't focused, so
// the poller's 5 s open-chat refresh doesn't run, and the default 25 s cache age showed messages ~20 s late.
// At most one Graph call per 4 s per open call.
import { chatMessagesCached, me } from '$lib/server/teams';
import { need, upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const chat = need(url.searchParams.get('chat'), 'chat');
	return upstream(async () => chatMessagesCached(chat, (await me()).id, 4_000));
};
