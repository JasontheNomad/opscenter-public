import { describe, expect, it } from 'vitest';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compress } from './compress';

const big = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Company ${i}` })) });
const req = (encoding = 'gzip, deflate, br', method = 'GET') => new Request('http://localhost/x', { method, headers: { 'accept-encoding': encoding } });
const res = (body: string, type = 'application/json', extra: Record<string, string> = {}) =>
	new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(body.length), ...extra } });

describe('compress', () => {
	it('brotli-compresses JSON when the browser accepts br, and it decodes back', async () => {
		const out = await compress(req(), res(big));
		expect(out.headers.get('content-encoding')).toBe('br');
		expect(out.headers.get('vary')).toContain('Accept-Encoding');
		expect(out.headers.get('content-length')).toBeNull();
		const buf = Buffer.from(await out.arrayBuffer());
		expect(buf.length).toBeLessThan(big.length / 3);
		expect(brotliDecompressSync(buf).toString()).toBe(big);
	});
	it('falls back to gzip', async () => {
		const out = await compress(req('gzip'), res(big, 'text/html; charset=utf-8'));
		expect(out.headers.get('content-encoding')).toBe('gzip');
		expect(gunzipSync(Buffer.from(await out.arrayBuffer())).toString()).toBe(big);
	});
	it('keeps status and other headers', async () => {
		const out = await compress(req(), new Response(big, { status: 404, headers: { 'content-type': 'application/json', 'x-frame-options': 'DENY' } }));
		expect(out.status).toBe(404);
		expect(out.headers.get('x-frame-options')).toBe('DENY');
	});
	it('leaves small bodies uncompressed', async () => {
		const out = await compress(req(), res('{"ok":true}'));
		expect(out.headers.get('content-encoding')).toBeNull();
		expect(await out.text()).toBe('{"ok":true}');
	});
	it('never touches the live-update stream, file downloads, or pre-encoded bodies', async () => {
		for (const r of [res(big, 'text/event-stream'), res(big, 'application/octet-stream'), res(big, 'image/png'), res(big, 'application/json', { 'content-encoding': 'gzip' })]) {
			const before = r.headers.get('content-encoding');
			const out = await compress(req(), r);
			expect(out).toBe(r);
			expect(out.headers.get('content-encoding')).toBe(before);
		}
	});
	it('does nothing when the browser accepts neither, or for HEAD', async () => {
		const r1 = res(big);
		expect(await compress(req('identity'), r1)).toBe(r1);
		const r2 = res(big);
		expect(await compress(req('br', 'HEAD'), r2)).toBe(r2);
	});
});
