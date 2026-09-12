// Pure: raw Graph message -> ChatMessage (HTML body, cards, attachments, reactions). No I/O.
import { escapeHtml, htmlToText, linkUrls } from '$lib/html';

export type Reaction = { emoji: string; count: number; mine: boolean };
export type ChatMessage = {
	id: string; at: string; from: string; fromId: string | null; html: string; text: string; me: boolean;
	files: { name: string; url: string }[];
	reactions: Reaction[];
	replyCount?: number; replies?: ChatMessage[]; mentionsMe?: boolean;
	edited?: boolean;
	parts?: EditPart[]; // own messages only — what an edit may keep or drop
};
/** One removable piece of a message body, addressed by a key the edit endpoint understands. */
export type EditPart = { key: string; kind: 'file' | 'image' | 'quote' | 'card'; name: string; url: string };
export type RawAtt = { id: string; name?: string; contentUrl?: string; contentType?: string; content?: string | null };
export type RawMsg = {
	id: string; createdDateTime: string; messageType: string; deletedDateTime?: string | null; lastEditedDateTime?: string | null; subject?: string | null;
	from?: { user?: { id?: string; displayName?: string }; application?: { displayName?: string } } | null;
	body: { contentType: string; content: string };
	attachments?: { id: string; name?: string; contentUrl?: string; contentType?: string; content?: string | null }[];
	reactions?: { reactionType: string; user?: { user?: { id?: string } } }[];
	mentions?: { mentioned?: { user?: { id?: string } } }[];
	replies?: RawMsg[];
};
export function toMsg(m: RawMsg, myId: string): ChatMessage {
	const atts = m.attachments ?? [];
	const subject = m.subject ? `<strong>${escape(m.subject)}</strong><br>` : '';
	return {
		id: m.id, at: m.createdDateTime,
		from: m.from?.user?.displayName ?? m.from?.application?.displayName ?? '',
		fromId: m.from?.user?.id ?? null,
		html: subject + (m.body.contentType === 'html' ? renderBody(m.body.content, atts) : escape(m.body.content).replace(/\n/g, '<br>')),
		text: htmlToText(m.body.content),
		me: m.from?.user?.id === myId,
		files: atts.filter((a) => a.contentUrl && a.contentType === 'reference' && !m.body.content.includes(`id="${a.id}"`)).map((a) => ({ name: a.name ?? 'file', url: fileProxy(a.contentUrl!) })),
		reactions: reactionsOf(m.reactions, myId),
		mentionsMe: (m.mentions ?? []).some((x) => x.mentioned?.user?.id === myId),
		edited: !!m.lastEditedDateTime,
		parts: m.from?.user?.id === myId ? editParts(m) : undefined,
		replies: (m.replies ?? []).filter((r) => r.messageType === 'message' && !r.deletedDateTime).map((r) => toMsg(r, myId)).sort((a, b) => a.at.localeCompare(b.at)),
		replyCount: (m.replies ?? []).filter((r) => r.messageType === 'message' && !r.deletedDateTime).length
	};
}
const REACTION_EMOJI: Record<string, string> = { like: '👍', heart: '❤️', laugh: '😆', surprised: '😮', sad: '😢', angry: '😠' };
const toEmoji = (t: string) => REACTION_EMOJI[t] ?? t;
function reactionsOf(raw: { reactionType: string; user?: { user?: { id?: string } } }[] | undefined, myId: string): Reaction[] {
	const m = new Map<string, Reaction>();
	for (const r of raw ?? []) {
		const e = toEmoji(r.reactionType);
		const cur = m.get(e) ?? { emoji: e, count: 0, mine: false };
		cur.count++;
		if (r.user?.user?.id === myId) cur.mine = true;
		m.set(e, cur);
	}
	return [...m.values()];
}
export type Quote = { id: string; from: string; fromId: string | null; preview: string };

// Graph-hosted images need a bearer token -> route through /api/teams/content
export const proxied = (url: string) => `/api/teams/content?u=${encodeURIComponent(url)}`;
// SharePoint/OneDrive file attachments -> /api/teams/file (Graph shares API)
export const fileProxy = (url: string) => `/api/teams/file?u=${encodeURIComponent(url)}`;
export const isImage = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
function renderBody(html: string, attachments: { id: string; name?: string; contentUrl?: string; contentType?: string; content?: string | null }[]) {
	let out = html
		.replace(/<img([^>]*?)src="(https:\/\/graph\.microsoft\.com\/[^"]+)"/g, (_, pre, u) => `<img${pre}data-zoom src="${proxied(u)}"`)
		// `<at` must end the tag name: a bare `<at[^>]*>` also matched `<attachment …>`, so a message with a
		// file or card *and* an @mention lost its attachment and showed a garbled mention
		.replace(/<at(?=[\s>])[^>]*>(.*?)<\/at>/g, '<span class="mention">@$1</span>')
		.replace(/<emoji[^>]*alt="([^"]*)"[^>]*>(?:<\/emoji>)?/g, '$1');
	// <attachment id="x"></attachment> placeholders -> chips / quotes / cards
	out = out.replace(/<attachment id="([^"]+)"><\/attachment>/g, (_, id) => {
		const a = attachments.find((x) => x.id === id);
		if (a?.contentType?.includes('card') && a.content) {
			try {
				const card = JSON.parse(a.content) as Record<string, unknown>;
				const parts: string[] = [];
				const buttons: string[] = [];
				const md = (t: string) => escape(t)
					.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
					.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
					.replace(/(^|\s)(https?:\/\/[^\s<]{60,})/g, (_m: string, pre: string, u: string) => `${pre}<a href="${u}" target="_blank" rel="noreferrer">link</a>`);
				let first = true;
				const walk = (n: unknown) => {
					if (Array.isArray(n)) return n.forEach(walk);
					if (!n || typeof n !== 'object') return;
					const o = n as Record<string, unknown>;
					const type = String(o.type ?? '');
					if (type === 'TextBlock' && typeof o.text === 'string' && o.text.trim()) {
						if (/used a Workflow template to send this card/i.test(o.text)) return;
						const size = String(o.size ?? '').toLowerCase(), weight = String(o.weight ?? '').toLowerCase();
						const big = first || size === 'large' || size === 'extralarge';
						const bold = weight === 'bolder' || size === 'medium';
						first = false;
						parts.push(`<div class="${big ? 'card-title' : bold ? 'card-h' : 'card-p'}">${md(o.text)}</div>`);
						return;
					}
					if (type === 'FactSet' && Array.isArray(o.facts)) {
						for (const f of o.facts as { title?: string; value?: string }[]) parts.push(`<div class="card-p"><strong>${escape(f.title ?? '')}</strong> ${md(f.value ?? '')}</div>`);
						return;
					}
					if (type === 'Action.OpenUrl' && typeof o.url === 'string') {
						const href = safeUrl(o.url);
						if (href) buttons.push(`<a class="card-btn" href="${href}" target="_blank" rel="noreferrer">${escape(String(o.title ?? 'Open'))}</a>`);
						return;
					}
					if (type === 'Image' && typeof o.url === 'string') { const src = safeUrl(o.url); if (src) parts.push(`<img src="${src}" alt="" data-zoom>`); return; }
					for (const k of ['body', 'items', 'columns', 'actions', 'content', 'card']) if (k in o) walk(o[k]);
				};
				walk(card);
				return `<div class="card">${parts.join('') || '<span class="muted">(card)</span>'}${buttons.length ? `<div class="card-actions">${buttons.join('')}</div>` : ''}</div>`;
			} catch { return '<div class="card muted">(card)</div>'; }
		}
		if (!a?.contentUrl) return '';
		const name = a.name ?? 'file';
		return isImage(name)
			? `<img src="${fileProxy(a.contentUrl)}" alt="${escape(name)}" loading="lazy" data-zoom>`
			: `<a class="file" href="${fileProxy(a.contentUrl)}" target="_blank" rel="noreferrer">📎 ${escape(name)}</a>`;
	});
	return out;
}

export const escape = escapeHtml;
// only http(s)/mailto may land in href/src built from remote content (adaptive cards)
const safeUrl = (u: string) => (/^(https?:|mailto:)/i.test(u.trim()) ? escape(u.trim()) : '');

// ---- Editing a message
// Graph's chatMessage update replaces the whole body, so an edit has to re-send the placeholder tags of
// every attachment and inline image it keeps — otherwise editing the text silently drops them. These two
// patterns are the single definition of what a body is made of; `editParts` lists the pieces for the UI
// and `rebuildBody` (messages.ts) puts the kept ones back. Keys are stable per message: an attachment by
// its id, an inline image by its position in the body.
export const ATT_TAG = /<attachment id="([^"]+)"><\/attachment>/g;
export const IMG_TAG = /<img[^>]*?src="(https:\/\/graph\.microsoft\.com\/[^"]+)"[^>]*>/g;

const partOf = (a: RawAtt): EditPart => {
	if (a.contentType === 'messageReference') return { key: `att:${a.id}`, kind: 'quote', name: 'Quoted message', url: '' };
	if (a.contentType?.includes('card')) return { key: `att:${a.id}`, kind: 'card', name: a.name ?? 'Card', url: '' };
	const name = a.name ?? 'file';
	return { key: `att:${a.id}`, kind: isImage(name) ? 'image' : 'file', name, url: a.contentUrl ? fileProxy(a.contentUrl) : '' };
};

export function editParts(m: RawMsg): EditPart[] {
	const atts = m.attachments ?? [];
	const content = m.body.contentType === 'html' ? m.body.content : '';
	const out: EditPart[] = [];
	const tagged = new Set<string>();
	for (const t of content.matchAll(ATT_TAG)) {
		tagged.add(t[1]);
		const a = atts.find((x) => x.id === t[1]);
		if (a) out.push(partOf(a));
	}
	let n = 0;
	for (const im of content.matchAll(IMG_TAG)) out.push({ key: `img:${n++}`, kind: 'image', name: 'Image', url: proxied(im[1]) });
	// an attachment with no placeholder tag still renders (see `files` above), so it is droppable too
	for (const a of atts) if (!tagged.has(a.id) && a.contentUrl) out.push(partOf(a));
	return out;
}

/** Rebuild a message body for an edit: the kept placeholder tags, the new text, the kept inline images.
 *  `keep` is the list of EditPart keys that survive; null keeps everything. */
export function rebuildBody(raw: string, text: string, keep: string[] | null): string {
	const tags: string[] = [];
	for (const t of raw.matchAll(ATT_TAG)) if (!keep || keep.includes(`att:${t[1]}`)) tags.push(t[0]);
	const imgs: string[] = [];
	let n = 0;
	for (const im of raw.matchAll(IMG_TAG)) {
		const key = `img:${n++}`;
		if (!keep || keep.includes(key)) imgs.push(im[0]);
	}
	const body = linkUrls(escape(text)).replace(/\n/g, '<br>');
	return tags.join('') + body + (imgs.length ? (body ? '<br>' : '') + imgs.join('') : '');
}
