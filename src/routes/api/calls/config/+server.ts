// What the client needs before it decides whether to boot the call engine at all.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { acsConfigured } from '$lib/server/acs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	json({ engine: env.CALLS_ENGINE === 'acs' ? 'acs' : 'deeplink', configured: acsConfigured() });
