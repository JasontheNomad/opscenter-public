import { viewCounts } from '$lib/server/tasks';
import { statusPayload } from '$lib/server/status';
import { meta } from '$lib/server/db';
import { omarchyTheme, followsOmarchy } from '$lib/server/theme';
import type { TextSizes } from '$lib/textSize';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ depends, request }) => {
	depends('app:theme'); // the theme watcher's SSE event invalidates just this
	return { counts: viewCounts(), teams: statusPayload(), textSize: meta.json<TextSizes>('ui_text_size', {}), theme: followsOmarchy(request) ? omarchyTheme() : null };
};
