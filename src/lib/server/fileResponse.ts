// Serve an untrusted file (vault attachment, Teams/SharePoint content) without letting it run as this origin.
// The app has no auth layer, so a script executing here could act as Jason everywhere. Only formats that
// can't carry script render inline; everything else downloads.
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
// SVG keeps its type so <img> thumbnails still render (script never runs inside <img>), but opening it
// directly downloads instead of rendering, and the sandbox is a second lock if a browser ever renders it.
const SVG = 'image/svg+xml';

export function fileResponse(body: BodyInit | null, type: string | null, name = ''): Response {
	const t = (type ?? '').split(';')[0].trim().toLowerCase();
	const inline = INLINE.has(t);
	const filename = name ? `; filename*=UTF-8''${encodeURIComponent(name)}` : '';
	const headers: Record<string, string> = {
		'content-type': inline || t === SVG ? t : 'application/octet-stream',
		'content-disposition': (inline ? 'inline' : 'attachment') + filename,
		'x-content-type-options': 'nosniff',
		'cache-control': 'private, max-age=3600'
	};
	// not on PDFs: Chromium's viewer may refuse to render inside a sandboxed document (its JS runs in the
	// viewer's own origin anyway, not ours)
	if (t !== 'application/pdf') headers['content-security-policy'] = 'sandbox';
	return new Response(body, { headers });
}
