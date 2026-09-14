// fetch with 429 back-off (Retry-After or a fallback). Shared by the HubSpot and Graph clients.
// `timeoutMs` caps each attempt (headers *and* body): without it a stalled socket hangs its caller — and
// the single-lock pollers behind it — until undici gives up minutes later. Leave it off for streamed
// downloads, where the body may legitimately take longer.
const MAX_WAIT_MS = 30_000;
export async function fetchRetry(
	url: string,
	init: RequestInit,
	opts: { attempts?: number; fallbackMs?: (attempt: number) => number; timeoutMs?: number } = {}
): Promise<Response> {
	const attempts = opts.attempts ?? 3;
	const fallbackMs = opts.fallbackMs ?? (() => 3000);
	for (let attempt = 0; ; attempt++) {
		const signal = init.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined);
		const res = await fetch(url, { ...init, signal });
		if (res.status !== 429 || attempt >= attempts) return res;
		const wait = Math.min(Number(res.headers.get('retry-after')) * 1000 || fallbackMs(attempt), MAX_WAIT_MS);
		await new Promise((r) => setTimeout(r, wait));
	}
}
