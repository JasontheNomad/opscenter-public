import { json } from '@sveltejs/kit';
import { resolveNotes } from '$lib/server/notes';
import { need } from '$lib/server/http';
import type { RequestHandler } from './$types';

// ?client=<folder>&n=<name>&n=<name>… -> { <name>: { client, file } | null }. Feeds `[[wiki-links]]` in a note preview.
export const GET: RequestHandler = ({ url }) => json(resolveNotes(need(url.searchParams.get('client'), 'client'), url.searchParams.getAll('n')));
