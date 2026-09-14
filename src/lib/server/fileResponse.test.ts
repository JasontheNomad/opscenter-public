import { describe, expect, it } from 'vitest';
import { fileResponse } from './fileResponse';

const headers = (type: string | null, name = '') => Object.fromEntries(fileResponse('x', type, name).headers);

describe('fileResponse', () => {
	it('renders raster images inline, sandboxed and never sniffed', () => {
		const h = headers('image/png');
		expect(h['content-type']).toBe('image/png');
		expect(h['content-disposition']).toBe('inline');
		expect(h['content-security-policy']).toBe('sandbox');
		expect(h['x-content-type-options']).toBe('nosniff');
	});
	it('ignores type parameters when deciding', () => {
		expect(headers('IMAGE/JPEG; charset=binary')['content-type']).toBe('image/jpeg');
	});
	it("renders PDFs inline without a sandbox (Chromium's viewer)", () => {
		const h = headers('application/pdf');
		expect(h['content-disposition']).toBe('inline');
		expect(h['content-security-policy']).toBeUndefined();
	});
	it('keeps the SVG type for <img> but downloads it when opened, sandboxed', () => {
		const h = headers('image/svg+xml');
		expect(h['content-type']).toBe('image/svg+xml');
		expect(h['content-disposition']).toBe('attachment');
		expect(h['content-security-policy']).toBe('sandbox');
	});
	it('downloads HTML and anything else as an opaque blob', () => {
		for (const t of ['text/html', 'application/xhtml+xml', 'text/javascript', null]) {
			const h = headers(t);
			expect(h['content-type']).toBe('application/octet-stream');
			expect(h['content-disposition']).toBe('attachment');
		}
	});
	it('encodes the download filename', () => {
		expect(headers('text/html', 'a b"c.html')['content-disposition']).toBe(`attachment; filename*=UTF-8''a%20b%22c.html`);
	});
});
