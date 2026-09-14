import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveNotes, searchNotes, listNotes, folderPaths, createFolder } from './notes';

// a throwaway vault and DB. `$env/dynamic/private` is fixed when vite loads, so it's mocked rather than set
const tmp = await vi.hoisted(async () => {
	const [fs, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opscenter-vault-'));
	fs.mkdirSync(path.join(dir, 'vault'));
	return { dir, vault: path.join(dir, 'vault'), db: path.join(dir, 'test.db') };
});
vi.mock('$env/dynamic/private', () => ({ env: { NOTES_DIR: tmp.vault, DB_PATH: tmp.db } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_CLIENTS_FOLDER: 'Law Clients' } })); // a two-word name, as configured
const { vault } = tmp;

beforeAll(() => {
	const write = (client: string, file: string, body: string) => {
		fs.mkdirSync(path.join(vault, client), { recursive: true });
		fs.writeFileSync(path.join(vault, client, file), body);
	};
	write('Acme', '2026-09-01 Kickoff.md', '# Kickoff\nReception agent went live.\nSee [[Runbook]]\n');
	write('Acme', 'Runbook.md', '# Runbook\nagent RECEPTION checklist\n');
	write('Zeta', 'Runbook.md', '# Zeta runbook\n');
	write('Zeta', 'Billing Notes.md', 'invoice cadence: monthly\n');
	write('Law Clients/Acme Law', 'Overview.md', '# Overview\n');
	write('Law Clients/Acme Law/Meetings', 'Standup.md', '# Standup\nweekly agenda\n');
	fs.mkdirSync(path.join(vault, 'Law Clients/Acme Law/attachments'));
	fs.mkdirSync(path.join(vault, '.trash'));
});
afterAll(() => fs.rmSync(tmp.dir, { recursive: true, force: true }));

describe('resolveNotes', () => {
	it('prefers the note\'s own folder, ignoring case, .md and #heading', () => {
		expect(resolveNotes('Zeta', ['runbook', 'Runbook.md', 'Runbook#Steps'])).toEqual({
			runbook: { client: 'Zeta', file: 'Runbook.md' },
			'Runbook.md': { client: 'Zeta', file: 'Runbook.md' },
			'Runbook#Steps': { client: 'Zeta', file: 'Runbook.md' }
		});
	});
	it('falls back to any folder, and honours a Folder/Name prefix', () => {
		expect(resolveNotes('Acme', ['billing notes'])).toEqual({ 'billing notes': { client: 'Zeta', file: 'Billing Notes.md' } });
		expect(resolveNotes('Acme', ['zeta/Runbook'])).toEqual({ 'zeta/Runbook': { client: 'Zeta', file: 'Runbook.md' } });
	});
	it('maps unknown names, unknown folders and escapes to null', () => {
		expect(resolveNotes('Acme', ['Nope', 'Nowhere/Runbook', '../Runbook', ''])).toEqual({ Nope: null, 'Nowhere/Runbook': null, '../Runbook': null, '': null });
	});
});

describe('searchNotes', () => {
	it('matches every word on one line, any order or case', () => {
		const hits = searchNotes('reception agent');
		expect(hits.map((h) => `${h.client}/${h.file}:${h.line}`)).toEqual(['Acme/2026-09-01 Kickoff.md:2', 'Acme/Runbook.md:2']);
		expect(searchNotes('AGENT reception')).toEqual(hits);
		expect(searchNotes('')).toEqual([]);
	});
});

describe('titles', () => {
	it('a note is named by its first # heading, else by its file', () => {
		const titles = Object.fromEntries(listNotes('Zeta').map((n) => [n.file, n.title]));
		expect(titles).toEqual({ 'Runbook.md': 'Zeta runbook', 'Billing Notes.md': 'Billing Notes' });
		expect(searchNotes('invoice')[0].title).toBe('Billing Notes');
		expect(searchNotes('kickoff')[0].title).toBe('Kickoff');
	});
});

describe('nested folders', () => {
	it('lists every folder, parents first, leaving out attachments and dot folders', () => {
		expect(folderPaths()).toEqual(['Acme', 'Law Clients', 'Law Clients/Acme Law', 'Law Clients/Acme Law/Meetings', 'Zeta']);
	});
	it('a deep note list adds the subfolders\' notes, each with its own folder', () => {
		expect(listNotes('Law Clients/Acme Law').map((n) => n.file)).toEqual(['Overview.md']);
		expect(listNotes('Law Clients/Acme Law', true).map((n) => `${n.folder}/${n.file}`).sort()).toEqual([
			'Law Clients/Acme Law/Meetings/Standup.md',
			'Law Clients/Acme Law/Overview.md'
		]);
	});
	it('search and wiki-links reach nested notes; a Folder/ prefix matches the end of a path', () => {
		expect(searchNotes('agenda').map((h) => h.client)).toEqual(['Law Clients/Acme Law/Meetings']);
		expect(resolveNotes('Zeta', ['acme law/Overview', 'Meetings/standup'])).toEqual({
			'acme law/Overview': { client: 'Law Clients/Acme Law', file: 'Overview.md' },
			'Meetings/standup': { client: 'Law Clients/Acme Law/Meetings', file: 'Standup.md' }
		});
	});
	it('createFolder cleans the name and nests it; hidden or empty names are refused', () => {
		expect(createFolder('Law Clients/Acme Law', 'Q3: Plans')).toBe('Law Clients/Acme Law/Q3 Plans');
		expect(fs.existsSync(path.join(vault, 'Law Clients/Acme Law/Q3 Plans'))).toBe(true);
		for (const bad of ['', '.hidden', '../x', 'attachments']) expect(() => createFolder('', bad)).toThrow();
	});
});
