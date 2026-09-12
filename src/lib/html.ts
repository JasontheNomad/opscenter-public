// Isomorphic HTML helpers (server renders Teams/HubSpot bodies; components render optimistic messages).
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]);
export const textToHtml = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');
// wrap bare http(s) URLs in already-escaped HTML with links; stops at escaped quotes/brackets.
// Trailing sentence punctuation stays outside, and so does a ")" with no "(" partner in the URL.
const count = (s: string, c: string) => s.split(c).length - 1;
export const linkUrls = (html: string) =>
	html.replace(/https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<])+/g, (u) => {
		let url = u;
		while (/[.,:!?]$/.test(url) || (url.endsWith(')') && count(url, '(') < count(url, ')'))) url = url.slice(0, -1);
		return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>${u.slice(url.length)}`;
	});
export const htmlToText = (html: string) =>
	html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();

// HubSpot composes quoted history into every outbound conversations reply and writes it into
// hs_email_text (the <div class="hs_reply_quote"> it mails out). The thread view wants what was
// actually typed, so the quote is cut at its header line.
export const stripQuotedReply = (text: string) =>
	text
		.replace(/\n+On [^\n]{0,200}\bwrote:[\s\S]*$/, '')
		.replace(/\n+-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i, '')
		.trimEnd();
