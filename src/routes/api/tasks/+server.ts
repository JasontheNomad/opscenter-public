import { json, error } from '@sveltejs/kit';
import { createTask } from '$lib/server/tasks';
import { isStatus } from '$lib/columns';
import type { RequestHandler } from './$types';
import { readBody } from '$lib/server/http';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	const title = String(body.title ?? '').trim();
	if (!title) error(400, 'title required');
	const status = isStatus(body.status) ? body.status : 'todo';
	return json(createTask(title, status), { status: 201 });
};
