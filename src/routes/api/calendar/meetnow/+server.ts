import { meetNow } from '$lib/server/teams';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = () => upstream(async () => ({ joinUrl: (await meetNow()).joinWebUrl }));
