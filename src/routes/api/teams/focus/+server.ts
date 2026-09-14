import { reportFocus } from '$lib/server/teams';
import { noContent, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const b = await readBody(request).catch(() => ({}) as Record<string, unknown>);
	// `client`: the reporting window's own id (one report per window); older builds send none
	const client = typeof b.client === 'string' && b.client ? b.client.slice(0, 64) : 'default';
	reportFocus(client, { focused: !!b.focused, chat: typeof b.chat === 'string' ? b.chat : null, channel: typeof b.channel === 'string' ? b.channel : null, notify: !!b.notify });
	return noContent();
};
