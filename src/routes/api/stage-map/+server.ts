import { error } from '@sveltejs/kit';
import { noContent, readBody } from '$lib/server/http';
import { setStageMap } from '$lib/server/tasks';
import { isStatus } from '$lib/columns';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request }) => {
	const { source, hs_stage, status } = await readBody(request);
	if (typeof source !== 'string' || typeof hs_stage !== 'string' || !isStatus(status))
		error(400, 'bad body');
	setStageMap(source, hs_stage, status);
	return noContent();
};
