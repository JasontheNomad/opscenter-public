// Served rather than static so the PWA window's chrome follows the Omarchy theme. Chromium reads
// theme_color at install and re-reads the manifest lazily, so a theme change can take a restart of
// the installed app to reach the title bar; the <meta name="theme-color"> in the layout is live.
import { json } from '@sveltejs/kit';
import { omarchyTheme, followsOmarchy } from '$lib/server/theme';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => {
	const theme = followsOmarchy(request) ? omarchyTheme() : null;
	return json({
		name: 'OpsCenter',
		short_name: 'OpsCenter',
		description: 'Local command center',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		display_override: ['window-controls-overlay', 'standalone'],
		// defaults are the layout.css --color-bg / --color-surface
		background_color: theme?.bg || '#0e0f11',
		theme_color: theme?.surface || '#151619',
		icons: [
			{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
			{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
		]
	});
};
