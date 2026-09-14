import { error } from '@sveltejs/kit';
import { meta } from '$lib/server/db';
import { noContent, readBody } from '$lib/server/http';
import { isTextArea, TEXT_SIZES, type TextSizes } from '$lib/textSize';
import type { RequestHandler } from './$types';

// { area, size } -> that area's font size (Settings → Text size)
export const PATCH: RequestHandler = async ({ request }) => {
	const { area, size } = await readBody(request);
	if (!isTextArea(area) || typeof size !== 'number' || !TEXT_SIZES.includes(size)) error(400, 'bad area or size');
	meta.setJson('ui_text_size', { ...meta.json<TextSizes>('ui_text_size', {}), [area]: size });
	return noContent();
};

// reset every area to the default
export const DELETE: RequestHandler = () => {
	meta.del('ui_text_size');
	return noContent();
};
