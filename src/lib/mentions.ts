// @mention helpers for the Teams composers. Pure — the picker state lives in mentionPicker.svelte.ts and
// the server turns "@Name" into Teams tags (applyMentions in server/teams/render.ts).
export type Person = { id: string; name: string };

/** The `@query` typed just before the caret (`at` = index of the "@"), or null when not mentioning. */
export function mentionQuery(before: string): { at: number; q: string } | null {
	const m = /(?:^|\s)@([^@\n]{0,40})$/.exec(before);
	// "@ " is not a mention, and past a few words it's a sentence, not a name
	if (!m || /^\s/.test(m[1]) || m[1].split(' ').length > 4) return null;
	return { at: before.length - m[1].length - 1, q: m[1] };
}

/** People whose name, or any word of it, starts with the query (all of them for a bare "@"). */
export function matchPeople(people: Person[], q: string, max = 8): Person[] {
	const s = q.trim().toLowerCase();
	return people
		.filter((p) => {
			const n = p.name.toLowerCase();
			return !s || n.startsWith(s) || n.split(/\s+/).some((w) => w.startsWith(s));
		})
		.slice(0, max);
}

/** Picked people still written as "@Name" in the text — a mention deleted from the draft is not sent. */
export const mentionsIn = (text: string, picked: Person[]) => picked.filter((p) => text.includes(`@${p.name}`));
