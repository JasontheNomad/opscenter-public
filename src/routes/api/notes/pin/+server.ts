import { setNotePin } from '$lib/server/notes';
import { need, noContent, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

// { client, file, pinned } -> pin or unpin a note. Pins live in meta, not in the vault.
export const POST: RequestHandler = async ({ request }) => {
	const { client, file, pinned } = await readBody(request);
	setNotePin(need(client, 'client'), need(file, 'file'), pinned !== false);
	return noContent();
};
