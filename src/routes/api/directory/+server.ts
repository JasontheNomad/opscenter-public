import { json } from '@sveltejs/kit';
import { listCompanies, listContacts } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

// Companies + contacts for the pickers. Kept out of the board's page data: at ~550 KB it was re-sent on
// every Projects/Support switch and every 90 s refresh, and made each one take ~2 s.
export const GET: RequestHandler = () => json({ companies: listCompanies(), contacts: listContacts() });
