import { redirect, type Handle } from '@sveltejs/kit';
import { startTeamsPoller, emit } from '$lib/server/teams';
import { startHubspotPoller } from '$lib/server/hubspotPoller';
import { env } from '$env/dynamic/private';
import { startThemeWatch } from '$lib/server/theme';
import { compress } from '$lib/server/compress';
// background jobs start with the server process
startTeamsPoller();
startHubspotPoller();
startThemeWatch(() => emit('theme')); // `omarchy theme set` -> open tabs re-read the palette
// adapter-node closes the HTTP server on SIGTERM, then emits this — but the pollers' timers would keep
// Node alive until systemd gave up and SIGKILLed it 90 s later, so every restart was 90 s of downtime.
process.on('sveltekit:shutdown', () => process.exit(0));

// The ACS Calling SDK refuses any origin that isn't https, file: or the literal host `localhost`,
// and the single-agent Web Lock is per-origin, so it doesn't span the two spellings either. Both failures
// are silent — calls quietly fall back to the Teams deep link — so send 127.0.0.1 to localhost
// rather than let it half-work. Same process, same loopback bind; only the spelling changes.
// No auth layer, so refuse any other Host: blocks DNS rebinding (a hostile page re-pointing its own
// domain at 127.0.0.1 would otherwise be same-origin with this API and pass SvelteKit's CSRF check).
// APP_HOST adds the public name this instance is served under (e.g. opscenter.<tailnet>.ts.net).
// Unset -> loopback only, which is how it runs on a laptop.
const HOSTS = new Set(['localhost', '127.0.0.1', ...(env.APP_HOST ? [env.APP_HOST.toLowerCase()] : [])]);
// SvelteKit's own CSRF check only covers form content types, and every route reads `request.json()`,
// which ignores Content-Type — so a cross-site page could POST a bodyless-type Blob with no preflight.
// Refuse any write whose Origin isn't ours. Compare the hostname: ORIGIN is unset, so adapter-node
// thinks it's https and `url.origin` never equals the browser's http://localhost:3000.
// No Origin (curl, scripts) is allowed — only browsers send one, and they always do on a cross-site write.
// With APP_HOST set (the VPS) the browser always arrives as https://APP_HOST, so accept exactly that
// origin and nothing else: a page served from localhost on the laptop (a dev server, some local tool)
// is not us there, and scheme and port count too.
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const APP_ORIGIN = env.APP_HOST ? `https://${env.APP_HOST.toLowerCase()}` : null;
function foreign(origin: string | null): boolean {
	if (!origin) return false;
	if (APP_ORIGIN) return origin.toLowerCase() !== APP_ORIGIN;
	try {
		return !HOSTS.has(new URL(origin).hostname);
	} catch {
		return true; // "null" (sandboxed iframe, file:) or garbage
	}
}
export const handle: Handle = async ({ event, resolve }) => {
	const { hostname, port, pathname, search } = event.url;
	if (!HOSTS.has(hostname)) return new Response('Forbidden', { status: 403 });
	if (!SAFE.has(event.request.method) && foreign(event.request.headers.get('origin')))
		return new Response('Forbidden', { status: 403 });
	if (hostname === '127.0.0.1') redirect(307, `http://localhost${port ? `:${port}` : ''}${pathname}${search}`);
	const res = await resolve(event);
	// Nothing here is ever meant to be framed (clickjacking "Cancel series" / "Delete client"), and a
	// browser must never guess a runnable type from a response's bytes.
	try {
		res.headers.set('x-frame-options', 'DENY');
		res.headers.set('x-content-type-options', 'nosniff');
	} catch {} // immutable headers (a passed-through fetch Response): leave them as they are
	return compress(event.request, res);
};
