import { json } from '@sveltejs/kit';
import { searchNotes } from '$lib/server/notes';
import { need } from '$lib/server/http';
import type { RequestHandler } from './$types';

// ?q=words -> { hits } across every client's notes. Feeds the Clients page sidebar search.
export const GET: RequestHandler = ({ url }) => json({ hits: searchNotes(need(url.searchParams.get('q'), 'q')) });
