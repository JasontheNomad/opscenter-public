// Remote message HTML (Teams bodies) -> safe for {@html}. DOMPurify needs a DOM and returns input
// unchanged without one, so this is browser-only; routes that render it set `ssr = false`.
import DOMPurify from 'dompurify';
import { browser } from '$app/environment';

// Memoised by input: every refresh of an open chat or channel re-renders every message, and running
// DOMPurify over all of them each time was most of the work. Bounded; oldest entries go first.
const seen = new Map<string, string>();
const MAX = 500;
export const cleanHtml = (html: string) => {
	if (!browser) return '';
	let out = seen.get(html);
	if (out === undefined) {
		out = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
		if (seen.size >= MAX) seen.delete(seen.keys().next().value!);
		seen.set(html, out);
	}
	return out;
};
