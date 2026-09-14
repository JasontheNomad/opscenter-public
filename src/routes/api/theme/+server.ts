// The Omarchy laptop pushes its active theme here from a theme-set hook (and once at login), since the
// server has no desktop of its own. Body is the raw colors.toml; ?name= is the theme slug.
// Values are hex-validated in setPushedTheme before anything is stored or rendered.
import { error, json } from '@sveltejs/kit';
import { setPushedTheme } from '$lib/server/theme';
import { emit } from '$lib/server/teams';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';

export const POST: RequestHandler = async ({ request, url }) => {
	const name = url.searchParams.get('name') ?? '';
	if (!/^[a-z0-9-]{1,64}$/.test(name)) error(400, 'name must be a theme slug');
	const toml = await request.text();
	if (toml.length > 8192) error(413, 'colors.toml too large');
	try {
		const theme = setPushedTheme(name, toml);
		emit('theme'); // open windows re-read the palette
		return json({ name: theme.name, mode: theme.mode });
	} catch (e) {
		error(400, errMsg(e));
	}
};
