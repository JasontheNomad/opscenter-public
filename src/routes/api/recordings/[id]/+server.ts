import { error } from '@sveltejs/kit';
import { recordingDownloadUrl } from '$lib/server/recordings';
import type { RequestHandler } from './$types';

// A recording note's player: redirect to a fresh pre-signed OneDrive link for the video. Fetched on every
// play, so the note never holds a link that has expired — and never one that works outside the app.
export const GET: RequestHandler = async ({ params }) => {
	const url = await recordingDownloadUrl(params.id);
	if (!url) error(404, 'recording not found');
	return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
};
