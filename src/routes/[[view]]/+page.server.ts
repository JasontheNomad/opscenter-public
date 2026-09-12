import { error } from '@sveltejs/kit';
import { listTasks } from '$lib/server/tasks';
import { VIEWS, isView } from '$lib/views';
import { folderForCompany, folderNames } from '$lib/server/notes';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const id = params.view ?? 'projects';
	if (!isView(id)) error(404, 'Not found');
	const tasks = listTasks(id);
	// notes folder per company on this board (fuzzy/linked); {} if NOTES_DIR unset
	const folders: Record<string, string> = {};
	if (env.NOTES_DIR) {
		const names = folderNames(); // one vault scan per load, not one per company
		for (const t of tasks)
			if (t.company_id && !(t.company_id in folders)) {
				const f = folderForCompany(t.company_id, t.company_name ?? null, names);
				if (f) folders[t.company_id] = f;
			}
	}
	// companies + contacts for the pickers come from /api/directory, once (see $lib/directory.svelte.ts)
	return { view: VIEWS.find((v) => v.id === id)!, tasks, folders };
};
