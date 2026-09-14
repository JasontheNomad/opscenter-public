import { error } from '@sveltejs/kit';
import { need, noContent, readBody } from '$lib/server/http';
import { linkCompanyFolder } from '$lib/server/notes';
import { errMsg } from '$lib/api';
import type { RequestHandler } from './$types';

// { folder, company_id } -> link a client folder (`<clients folder>/<client>`) to a HubSpot company (null company_id is a no-op)
export const POST: RequestHandler = async ({ request }) => {
	const { folder, company_id } = await readBody(request);
	const dir = need(folder, 'folder');
	if (company_id !== null && typeof company_id !== 'string') error(400, 'bad company_id');
	if (company_id)
		try {
			linkCompanyFolder(company_id, dir);
		} catch (e) {
			error(400, errMsg(e));
		}
	return noContent();
};
