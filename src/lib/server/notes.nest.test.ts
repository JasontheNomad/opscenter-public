import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { nestClientFolders, ensureClientFolders, clientNames, listNotes, folderForCompany, deleteFolder } from './notes';
import { db, meta } from './db';

// a throwaway vault and DB. `$env/dynamic/private` is fixed when vite loads, so it's mocked rather than set
const tmp = await vi.hoisted(async () => {
	const [fs, os, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opscenter-nest-'));
	fs.mkdirSync(path.join(dir, 'vault'));
	return { dir, vault: path.join(dir, 'vault'), db: path.join(dir, 'test.db') };
});
vi.mock('$env/dynamic/private', () => ({ env: { NOTES_DIR: tmp.vault, DB_PATH: tmp.db } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_CLIENTS_FOLDER: 'Law Clients' } })); // a two-word name, as configured
const { vault } = tmp;

beforeAll(() => {
	fs.mkdirSync(path.join(vault, 'Acme'));
	fs.writeFileSync(path.join(vault, 'Acme', 'a.md'), '# A\n');
	fs.mkdirSync(path.join(vault, 'Zeta'));
	fs.mkdirSync(path.join(vault, '.trash'));
	meta.setJson('note_pins', { Acme: ['a.md'] });
	const co = db.prepare('INSERT INTO companies (id, name, notes_dir) VALUES (?, ?, ?)');
	co.run('co1', 'Acme Law Group', 'Acme');
	co.run('co2', 'Brand New Firm', null);
	co.run('co3', 'Quiet Co', null);
	co.run('co5', 'Zeta Partners', null); // no link: found by name
	const task = db.prepare('INSERT INTO tasks (title, company_id) VALUES (?, ?)');
	task.run('t1', 'co1');
	task.run('t2', 'co2');
});
afterAll(() => fs.rmSync(tmp.dir, { recursive: true, force: true }));

describe('nestClientFolders', () => {
	it('moves the top-level folders under Law Clients, re-keys pins and gives companies with tickets a folder', () => {
		nestClientFolders();
		expect(fs.readdirSync(vault).sort()).toEqual(['.trash', 'Law Clients']);
		// Quiet Co has no tickets, so no folder
		expect(clientNames()).toEqual(['Acme', 'Brand New Firm', 'Zeta']);
		expect(listNotes('Law Clients/Acme')).toMatchObject([{ folder: 'Law Clients/Acme', file: 'a.md', pinned: true }]);
		expect(folderForCompany('co1', 'Acme Law Group')).toBe('Law Clients/Acme');
		expect(folderForCompany('co2', 'Brand New Firm')).toBe('Law Clients/Brand New Firm');
		// unlinked company, name known only to the DB (the ticket Notes tab's case)
		expect(folderForCompany('co5', null)).toBe('Law Clients/Zeta');
		expect(folderForCompany('nope', null)).toBeNull();
	});
	it('runs once: a later top-level folder stays where it is', () => {
		fs.mkdirSync(path.join(vault, 'Personal'));
		nestClientFolders();
		expect(fs.existsSync(path.join(vault, 'Personal'))).toBe(true);
	});
});

describe('ensureClientFolders', () => {
	it('skips companies that already have a folder, and unknown ids', () => {
		ensureClientFolders(['co1', 'co2', 'nope']);
		expect(clientNames()).toEqual(['Acme', 'Brand New Firm', 'Zeta']);
	});
	it('makes one for a company whose folder was deleted, only when asked again', () => {
		deleteFolder('Law Clients/Zeta');
		deleteFolder('Law Clients/Brand New Firm');
		expect(folderForCompany('co2', null)).toBeNull(); // the link went with the folder
		ensureClientFolders(['co2']);
		expect(clientNames()).toEqual(['Acme', 'Brand New Firm']);
	});
});

describe('deleteFolder', () => {
	it('refuses the vault root and Law Clients itself', () => {
		expect(() => deleteFolder('')).toThrow();
		expect(() => deleteFolder('Law Clients')).toThrow();
	});
});
