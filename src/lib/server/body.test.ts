import { describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { readBody } from './body';
import { isPriority } from '$lib/priority';

const post = (body: string) => new Request('http://localhost/x', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
const status = async (p: Promise<unknown>) => {
	try {
		await p;
		return 200;
	} catch (e) {
		return isHttpError(e) ? e.status : 500;
	}
};

describe('readBody', () => {
	it('returns the object', async () => {
		expect(await readBody(post('{"a":1,"b":"x"}'))).toEqual({ a: 1, b: 'x' });
	});
	it('answers 400, not 500, for a malformed or non-object body', async () => {
		for (const bad of ['{nope', '', '[1,2]', '"str"', 'null', '42']) expect(await status(readBody(post(bad)))).toBe(400);
	});
});

describe('isPriority', () => {
	it('accepts the five levels only', () => {
		for (const ok of [0, 1, 2, 3, 4]) expect(isPriority(ok)).toBe(true);
		for (const bad of [-1, 5, 7, 1.5, '2', null, undefined, NaN]) expect(isPriority(bad)).toBe(false);
	});
});
