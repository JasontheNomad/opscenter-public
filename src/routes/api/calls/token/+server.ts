// CTE token for the browser Calling SDK. Cached and refreshed in acs.ts; the client just re-GETs.
import { cteToken } from '$lib/server/acs';
import { upstream } from '$lib/server/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => upstream(() => cteToken());
