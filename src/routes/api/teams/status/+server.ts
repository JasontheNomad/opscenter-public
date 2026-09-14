import { json } from '@sveltejs/kit';
import { statusPayload } from '$lib/server/status';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = () => json(statusPayload());
