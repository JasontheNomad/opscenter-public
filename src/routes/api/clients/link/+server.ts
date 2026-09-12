import { error } from '@sveltejs/kit';
import { need, noContent, readBody } from '$lib/server/http';
import { linkCompanyFolder } from '$lib/server/notes';
import type { RequestHandler } from './$types';

// { folder, company_id } -> link the vault folder to a HubSpot company (null company_id is a no-op)
export const POST: RequestHandler = async ({ request }) => {
	const { folder, company_id } = await readBody(request);
	const dir = need(folder, 'folder');
	if (company_id !== null && typeof company_id !== 'string') error(400, 'bad company_id');
	if (company_id) linkCompanyFolder(company_id, dir);
	return noContent();
};
