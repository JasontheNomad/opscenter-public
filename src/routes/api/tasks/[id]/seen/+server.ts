import { error } from '@sveltejs/kit';
import { getTask, markSeen } from '$lib/server/tasks';
import { intId, noContent } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = ({ params }) => {
	const id = intId(params.id);
	if (!getTask(id)) error(404, 'not found');
	markSeen(id);
	return noContent();
};
