// Runs in America/Phoenix (vite.config.ts test.env), like the VPS. Arizona has no DST: UTC−7 all year.
import { describe, expect, it } from 'vitest';
import { newer, weekOf, ymd } from './dates';

describe('weekOf', () => {
	it('starts the week at local Sunday midnight, not UTC midnight', () => {
		// Friday 2026-09-11 -> Sunday 2026-09-06 00:00 Phoenix = 07:00 UTC
		expect(weekOf('2026-09-11')).toEqual({ start: '2026-09-06T07:00:00.000Z', end: '2026-09-13T07:00:00.000Z' });
	});
	it('puts Sunday and Saturday in the same week', () => {
		expect(weekOf('2026-09-06').start).toBe('2026-09-06T07:00:00.000Z');
		expect(weekOf('2026-09-12').start).toBe('2026-09-06T07:00:00.000Z');
	});
	it('steps whole weeks either way, across a month boundary', () => {
		expect(weekOf('2026-09-11', -1).start).toBe('2026-08-30T07:00:00.000Z');
		expect(weekOf('2026-09-11', 1)).toEqual({ start: '2026-09-13T07:00:00.000Z', end: '2026-09-20T07:00:00.000Z' });
	});
	it('falls back to the current week for a missing or malformed date', () => {
		for (const d of [null, 'next friday', '2026-9-1']) {
			const start = new Date(weekOf(d).start);
			expect(start.getDay()).toBe(0);
			expect(start.getHours()).toBe(0);
			expect(Date.now() - start.getTime()).toBeLessThan(7 * 86400_000);
		}
	});
});

describe('ymd', () => {
	it('is the local calendar date, not the UTC one', () => {
		// 2026-09-12 03:00 UTC is still the evening of the 11th in Arizona
		expect(ymd(new Date('2026-09-12T03:00:00Z'))).toBe('2026-09-11');
	});
});

describe('newer', () => {
	it('compares instants, not strings', () => {
		// string order says "…00Z" > "…00.500Z"; in time it is the other way round
		expect(newer('2026-09-11T10:00:00.500Z', '2026-09-11T10:00:00Z')).toBe(true);
		expect(newer('2026-09-11T10:00:00Z', '2026-09-11T10:00:00.500Z')).toBe(false);
	});
	it('treats an equal time as not newer (a lagging read of our own write)', () => {
		expect(newer('2026-09-11T10:00:00.000Z', '2026-09-11T10:00:00Z')).toBe(false);
	});
	it('anything beats never; nothing beats anything', () => {
		expect(newer('2026-09-11T10:00:00Z', null)).toBe(true);
		expect(newer(null, '2026-09-11T10:00:00Z')).toBe(false);
		expect(newer(null, null)).toBe(false);
	});
});
