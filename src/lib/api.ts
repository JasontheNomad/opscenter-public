// One JSON fetch for every component. Throws Error(message) on non-2xx (reads {error} or SvelteKit's {message}).
// `keepalive`: let the request outlive the page (a save fired while the window closes).
export async function api<T = unknown>(path: string, method = 'GET', body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
	const r = await fetch(path, {
		method,
		keepalive: opts.keepalive,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	if (r.status === 204) return undefined as T;
	const data = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(data.error ?? data.message ?? String(r.status));
	return data as T;
}
export const post = <T = unknown>(path: string, body?: unknown) => api<T>(path, 'POST', body);
// A thrown value as display text: the message alone (String(err) prefixes "Error: "). Isomorphic.
export const errMsg = (e: unknown): string =>
	e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : String(e);
