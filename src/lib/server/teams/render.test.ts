import { describe, expect, it } from 'vitest';
import { editParts, rebuildBody, toMsg, type RawMsg } from './render';

const ME = 'me-id';
const msg = (over: Partial<RawMsg> = {}): RawMsg => ({
	id: 'm1',
	createdDateTime: '2026-09-11T10:00:00Z',
	messageType: 'message',
	from: { user: { id: 'u1', displayName: 'Dana' } },
	body: { contentType: 'text', content: 'hello' },
	...over
});
const card = (content: unknown): RawMsg =>
	msg({
		body: { contentType: 'html', content: '<attachment id="c1"></attachment>' },
		attachments: [{ id: 'c1', contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(content) }]
	});

describe('toMsg', () => {
	it('escapes a plain-text body', () => {
		const m = toMsg(msg({ body: { contentType: 'text', content: '<script>x</script>\nline' } }), ME);
		expect(m.html).toBe('&lt;script&gt;x&lt;/script&gt;<br>line');
		expect(m.from).toBe('Dana');
		expect(m.me).toBe(false);
	});
	it('marks my own messages and mentions of me', () => {
		const m = toMsg(msg({ from: { user: { id: ME } }, mentions: [{ mentioned: { user: { id: ME } } }] }), ME);
		expect(m.me).toBe(true);
		expect(m.mentionsMe).toBe(true);
	});
	it('groups reactions per emoji and flags mine', () => {
		const m = toMsg(msg({ reactions: [{ reactionType: 'like', user: { user: { id: 'u2' } } }, { reactionType: 'like', user: { user: { id: ME } } }, { reactionType: 'heart' }] }), ME);
		expect(m.reactions).toEqual([
			{ emoji: '👍', count: 2, mine: true },
			{ emoji: '❤️', count: 1, mine: false }
		]);
	});
	it('keeps only real replies, oldest first', () => {
		const m = toMsg(
			msg({
				replies: [
					msg({ id: 'r2', createdDateTime: '2026-09-11T10:02:00Z' }),
					msg({ id: 'r1', createdDateTime: '2026-09-11T10:01:00Z' }),
					msg({ id: 'sys', messageType: 'systemEventMessage' }),
					msg({ id: 'gone', deletedDateTime: '2026-09-11T10:03:00Z' })
				]
			}),
			ME
		);
		expect(m.replies?.map((r) => r.id)).toEqual(['r1', 'r2']);
		expect(m.replyCount).toBe(2);
	});
	it('routes Graph images and file attachments through the app proxies', () => {
		const m = toMsg(
			msg({
				body: { contentType: 'html', content: '<img src="https://graph.microsoft.com/v1.0/x/$value"><attachment id="f1"></attachment><at id="0">Sam</at>' },
				attachments: [{ id: 'f1', name: 'report.pdf', contentUrl: 'https://tenant.sharepoint.com/r.pdf', contentType: 'reference' }]
			}),
			ME
		);
		expect(m.html).toContain('src="/api/teams/content?u=https%3A%2F%2Fgraph.microsoft.com');
		expect(m.html).toContain('href="/api/teams/file?u=https%3A%2F%2Ftenant.sharepoint.com%2Fr.pdf"');
		expect(m.html).toContain('<span class="mention">@Sam</span>');
		expect(m.files).toEqual([]); // shown inline, so not listed again
	});
	it('lists reference files that the body does not show', () => {
		const m = toMsg(msg({ attachments: [{ id: 'f9', name: 'plan.docx', contentUrl: 'https://t.sharepoint.com/p.docx', contentType: 'reference' }] }), ME);
		expect(m.files).toEqual([{ name: 'plan.docx', url: '/api/teams/file?u=https%3A%2F%2Ft.sharepoint.com%2Fp.docx' }]);
	});
});

describe('adaptive cards', () => {
	it('renders text escaped, with **bold**', () => {
		const html = toMsg(card({ type: 'AdaptiveCard', body: [{ type: 'TextBlock', text: 'Deploy **done** <img src=x onerror=alert(1)>' }] }), ME).html;
		expect(html).toContain('<strong>done</strong>');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).not.toContain('<img src=x');
	});
	it('keeps http(s) buttons and drops javascript: ones', () => {
		const html = toMsg(
			card({ type: 'AdaptiveCard', actions: [{ type: 'Action.OpenUrl', title: 'Open', url: 'https://example.com/run' }, { type: 'Action.OpenUrl', title: 'Evil', url: 'javascript:alert(1)' }] }),
			ME
		).html;
		expect(html).toContain('href="https://example.com/run"');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('Evil');
	});
	it('drops images with a non-http(s) source', () => {
		const html = toMsg(card({ type: 'AdaptiveCard', body: [{ type: 'Image', url: 'data:image/svg+xml,<svg onload=alert(1)>' }] }), ME).html;
		expect(html).not.toContain('<img');
	});
	it('shows a placeholder for an unreadable card', () => {
		const m = msg({ body: { contentType: 'html', content: '<attachment id="c1"></attachment>' }, attachments: [{ id: 'c1', contentType: 'application/vnd.microsoft.card.adaptive', content: '{not json' }] });
		expect(toMsg(m, ME).html).toContain('(card)');
	});
});

// Editing replaces the whole body upstream, so these two decide whether an edit keeps or loses a
// message's attachments and inline images.
describe('editing a message', () => {
	const IMG = '<img src="https://graph.microsoft.com/v1.0/chats/c/messages/m/hostedContents/1/$value">';
	const body = (content: string) => ({ contentType: 'html', content });
	const mine = (content: string, attachments: RawMsg['attachments'] = []) =>
		msg({ from: { user: { id: ME, displayName: 'Me' } }, body: body(content), attachments });

	it('lists a quote, an inline image and a file as removable parts', () => {
		const m = mine(`<attachment id="q1"></attachment>hi${IMG}`, [
			{ id: 'q1', contentType: 'messageReference', content: '{}' },
			{ id: 'f1', contentType: 'reference', name: 'notes.pdf', contentUrl: 'https://x.sharepoint.com/notes.pdf' }
		]);
		expect(editParts(m).map((p) => [p.key, p.kind])).toEqual([
			['att:q1', 'quote'],
			['img:0', 'image'],
			['att:f1', 'file']
		]);
	});
	it('only lists parts on your own messages', () => {
		expect(toMsg(msg({ body: body('hi') }), ME).parts).toBeUndefined();
		expect(toMsg(mine('hi'), ME).parts).toEqual([]);
	});
	it('keeps every tag when nothing was dropped', () => {
		const raw = `<attachment id="q1"></attachment>old text${IMG}`;
		const out = rebuildBody(raw, 'new text', null);
		expect(out).toBe(`<attachment id="q1"></attachment>new text<br>${IMG}`);
	});
	it('drops only the parts left out of the keep list', () => {
		const raw = `<attachment id="q1"></attachment>old${IMG}`;
		expect(rebuildBody(raw, 'new', ['att:q1'])).toBe('<attachment id="q1"></attachment>new');
		expect(rebuildBody(raw, 'new', ['img:0'])).toBe(`new<br>${IMG}`);
		expect(rebuildBody(raw, 'new', [])).toBe('new');
	});
	it('escapes the edited text', () => {
		expect(rebuildBody('old', '<b>x</b>\nnext', null)).toBe('&lt;b&gt;x&lt;/b&gt;<br>next');
	});
	it('reports an edited message', () => {
		expect(toMsg(msg({ lastEditedDateTime: '2026-09-12T10:00:00Z' }), ME).edited).toBe(true);
		expect(toMsg(msg(), ME).edited).toBe(false);
	});
});
