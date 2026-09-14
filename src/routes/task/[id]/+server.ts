import { redirect, error } from '@sveltejs/kit';
import { viewForTask } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

// /task/123 → the board that task lives on, with its panel open
export const GET: RequestHandler = ({ params }) => {
	const id = Number(params.id);
	const view = id ? viewForTask(id) : null;
	if (!view) error(404, 'Not found');
	redirect(302, `/${view}?task=${id}`);
};
