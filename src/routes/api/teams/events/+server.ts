import { onTeamsEvent } from '$lib/server/teams';
import type { RequestHandler } from './$types';

// Server-Sent Events: "chats" / "channels" when the poller sees new activity; keepalive every 25s
export const GET: RequestHandler = () => {
	let off = () => {};
	let ka: ReturnType<typeof setInterval>;
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (event: string, data: unknown) => {
				try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
			};
			send('hello', { at: Date.now() });
			off = onTeamsEvent(send);
			ka = setInterval(() => send('ping', {}), 25_000);
		},
		cancel() { off(); clearInterval(ka); }
	});
	return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
};
