// Compress text responses (pages, __data.json, API JSON). Static assets are pre-compressed at build time
// (adapter-node `precompress`); this covers everything SvelteKit renders. Nothing in front of the app
// compresses — `tailscale serve` passes bytes through — so without this every JSON and HTML response
// crossed the tailnet raw.
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const TEXT = /^(text\/(html|plain|css|csv)|application\/(json|javascript|manifest\+json|xml)|image\/svg\+xml)/i;
const MIN_BYTES = 1024; // below this the headers cost more than they save

export async function compress(request: Request, res: Response): Promise<Response> {
	const type = res.headers.get('content-type') ?? '';
	const accept = request.headers.get('accept-encoding') ?? '';
	if (
		!res.body ||
		request.method === 'HEAD' ||
		res.status === 204 ||
		res.status === 304 ||
		res.headers.has('content-encoding') ||
		!TEXT.test(type) || // also excludes the SSE stream (text/event-stream) and file downloads
		!/\b(br|gzip)\b/.test(accept)
	)
		return res;
	const raw = Buffer.from(await res.arrayBuffer());
	const headers = new Headers(res.headers);
	headers.append('vary', 'Accept-Encoding');
	if (raw.length < MIN_BYTES) return new Response(raw, { status: res.status, statusText: res.statusText, headers });
	const br = /\bbr\b/.test(accept);
	// brotli at quality 4: most of the size win for a few ms on a 1-vCPU box (11 = max, and slow)
	const body = br ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }) : gzipSync(raw, { level: 6 });
	headers.set('content-encoding', br ? 'br' : 'gzip');
	headers.delete('content-length');
	return new Response(body, { status: res.status, statusText: res.statusText, headers });
}
