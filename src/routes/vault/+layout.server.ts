import { error } from '@sveltejs/kit';
import { listFolders } from '$lib/server/notes';
import type { LayoutServerLoad } from './$types';
import { errMsg } from '$lib/api';

// The folder tree reads every folder in the vault. As a layout load with no params or URL in it, it runs
// once per visit — not on every note opened, tab switched or link hovered, which is what it did as part
// of the page load. Creating/deleting notes and folders invalidates it.
export const load: LayoutServerLoad = () => {
	try {
		return { folders: listFolders() };
	} catch (e) {
		error(500, errMsg(e));
	}
};
