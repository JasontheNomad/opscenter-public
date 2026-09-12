import { describe, expect, it } from 'vitest';
import { escapeHtml, htmlToText, linkUrls, stripQuotedReply, textToHtml } from './html';

describe('escapeHtml / textToHtml', () => {
	it('escapes all five HTML-significant characters', () => {
		expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
	});
	it('turns newlines into <br> after escaping', () => {
		expect(textToHtml('a<b\nc')).toBe('a&lt;b<br>c');
	});
});

describe('linkUrls', () => {
	it('links a bare URL and keeps trailing sentence punctuation outside', () => {
		expect(linkUrls('see https://example.com/a.')).toBe('see <a href="https://example.com/a" target="_blank" rel="noreferrer">https://example.com/a</a>.');
	});
	it('keeps a balanced parenthesis inside the URL, an unbalanced one outside', () => {
		expect(linkUrls('https://en.wikipedia.org/wiki/Foo_(bar)')).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
		expect(linkUrls('(https://example.com)')).toBe('(<a href="https://example.com" target="_blank" rel="noreferrer">https://example.com</a>)');
	});
	it('stops at an escaped quote so it never breaks out of the attribute', () => {
		const out = linkUrls(escapeHtml('"https://example.com/x"'));
		expect(out).toContain('href="https://example.com/x"');
		expect(out).not.toContain('&quot;"');
	});
});

describe('htmlToText', () => {
	it('keeps paragraph and line breaks and decodes entities', () => {
		expect(htmlToText('<p>one</p><p>two &amp; three</p>line<br/>next')).toBe('one\ntwo & three\nline\nnext');
	});
	it('collapses runs of blank lines', () => {
		expect(htmlToText('a<br><br><br><br>b')).toBe('a\n\nb');
	});
});

describe('stripQuotedReply', () => {
	it('cuts the history HubSpot appends to an outbound reply', () => {
		const body = [
			'Test reply',
			'',
			'On Fri, Sep 11, 2026 at 5:07 PM, Dana Reed <dana@agency.example> wrote:',
			'>Hey there! Your ticket has been assigned to me.'
		].join('\n');
		expect(stripQuotedReply(body)).toBe('Test reply');
	});
	it('cuts an Original Message divider', () => {
		expect(stripQuotedReply('hi\n\n----- Original Message -----\nolder')).toBe('hi');
	});
	it('leaves a message with no quote alone', () => {
		expect(stripQuotedReply('just this\nand this')).toBe('just this\nand this');
	});
	it("doesn't cut on the word wrote mid-sentence", () => {
		expect(stripQuotedReply('On Tuesday I wrote the script')).toBe('On Tuesday I wrote the script');
	});
});
