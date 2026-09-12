import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Put = { body: { client: string; file: string; body: string; base: string | null }; resolve: (v: { mtime: string }) => void; reject: (e: Error) => void };
const puts: Put[] = [];
vi.mock('$lib/api', () => ({
	api: (_url: string, _method: string, body: Put['body']) =>
		new Promise((resolve, reject) => puts.push({ body, resolve, reject })),
	errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e))
}));
const { NoteSession } = await import('./noteSession.svelte');

const flush = () => new Promise((r) => setTimeout(r, 0));
let n = 0;
const fresh = (mtime: string | null = 'm0') => new NoteSession('Acme', `note${++n}.md`, 'start', mtime);

beforeEach(() => {
	puts.length = 0;
});
// the save queue is shared by all notes: settle whatever a test left in flight
afterEach(async () => {
	vi.useRealTimers();
	for (const p of puts) p.resolve({ mtime: 'end' });
	await flush();
});

describe('NoteSession', () => {
	it('starts saved, autosaves 800 ms after the last keystroke', async () => {
		vi.useFakeTimers();
		const s = fresh();
		expect(s.saved).toBe(true);
		s.edit('a');
		s.edit('ab');
		expect(s.saved).toBe(false);
		await vi.advanceTimersByTimeAsync(799);
		expect(puts).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(puts).toHaveLength(1);
		expect(puts[0].body).toMatchObject({ body: 'ab', base: 'm0' });
		puts[0].resolve({ mtime: 'm1' });
		await vi.advanceTimersByTimeAsync(0);
		expect(s.saved).toBe(true);
	});

	it('runs saves one at a time, each on the mtime the previous one produced', async () => {
		const s = fresh();
		s.edit('one');
		void s.save();
		s.edit('two');
		const done = s.save();
		await flush();
		expect(puts).toHaveLength(1); // second waits for the first
		puts[0].resolve({ mtime: 'm1' });
		await flush();
		expect(puts).toHaveLength(2);
		expect(puts[1].body).toMatchObject({ body: 'two', base: 'm1' });
		puts[1].resolve({ mtime: 'm2' });
		await done;
		expect(s.saved).toBe(true);
	});

	it('a save landing while newer keystrokes wait does not mark them saved', async () => {
		const s = fresh();
		s.edit('one');
		void s.save();
		await flush();
		s.edit('one more');
		puts[0].resolve({ mtime: 'm1' });
		await flush();
		expect(s.saved).toBe(false);
	});

	it('shows a refused save, and Retry sends it again', async () => {
		const s = fresh();
		s.edit('x');
		void s.save();
		await flush();
		puts[0].reject(new Error('changed elsewhere'));
		await flush();
		expect(s.error).toBe('changed elsewhere');
		expect(s.saved).toBe(false);
		const retry = s.save();
		await flush();
		puts[1].resolve({ mtime: 'm1' });
		await retry;
		expect(s.error).toBe('');
		expect(s.saved).toBe(true);
	});

	it('a note reopened before its last save landed uses that save’s mtime as base', async () => {
		const first = new NoteSession('Acme', 'same.md', 'a', 'm0');
		first.edit('b');
		void first.save();
		await flush();
		puts[0].resolve({ mtime: 'm5' });
		await flush();
		const again = new NoteSession('Acme', 'same.md', 'b', 'm0'); // page loaded before the save landed
		again.edit('c');
		void again.save();
		await flush();
		expect(puts[1].body.base).toBe('m5');
	});

	it('does nothing when already saved', async () => {
		await fresh().save();
		expect(puts).toHaveLength(0);
	});
});
