import { syncAll } from '$lib/server/sync';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = () => upstream(syncAll);
