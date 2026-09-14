// Request bodies for +server.ts routes. Pure (no DB at import), so it's unit-tested (body.test.ts).
import { error } from '@sveltejs/kit';

/**
 * The request's JSON body as a plain object, or a 400. `request.json()` on a malformed body threw, which
 * came out as a 500; and its `any` let every handler skip checking what it got. Fields here are
 * `unknown` — narrow each one (need(), typeof, isStatus…) before using it.
 */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
	let v: unknown;
	try {
		v = await request.json();
	} catch {
		error(400, 'expected a JSON body');
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) error(400, 'expected a JSON object');
	return v as Record<string, unknown>;
}
