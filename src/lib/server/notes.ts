// Markdown notes on disk. NOTES_DIR/<client>/<note>.md — same files Obsidian edits.
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { db, meta } from './db';
import { ymd, nowIso } from '$lib/dates';
import { cleanName, uniqueMatch } from './names';

const ROOT = () => {
	if (!env.NOTES_DIR) throw new Error('NOTES_DIR not set');
	return path.resolve(env.NOTES_DIR);
};

// resolve + guarantee we stay inside ROOT (no ../ escapes)
function safe(...parts: string[]) {
	const root = ROOT();
	const p = path.resolve(root, ...parts);
	if (p !== root && !p.startsWith(root + path.sep)) throw new Error('bad path');
	return p;
}

export type Client = { name: string; notes: number; updated_at: string; company_id: string | null };
export type NoteMeta = { file: string; title: string; excerpt: string; updated_at: string; pinned: boolean };

// Pinned notes, per client folder: { "<client>": ["a.md", "b.md"] } in meta. Pinning is a view
// preference, not part of the vault — a note carries no marker on disk, so Obsidian or any other
// editor sees an ordinary file.
const PINS = 'note_pins';
const allPins = () => meta.json<Record<string, string[]>>(PINS, {});
export const notePins = (client: string): string[] => allPins()[client] ?? [];
export function setNotePin(client: string, file: string, pinned: boolean) {
	const all = allPins();
	const next = (all[client] ?? []).filter((f) => f !== file);
	if (pinned) next.push(file);
	if (next.length) all[client] = next;
	else delete all[client];
	meta.setJson(PINS, all);
}

const isMd = (f: string) => f.endsWith('.md') && !f.startsWith('.');

function listClients(): Client[] {
	const root = ROOT();
	if (!fs.existsSync(root)) return [];
	const links = new Map(
		(db.prepare('SELECT id, notes_dir FROM companies WHERE notes_dir IS NOT NULL').all() as { id: string; notes_dir: string }[])
			.map((r) => [r.notes_dir, r.id])
	);
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('.'))
		.map((d) => {
			const files = fs.readdirSync(path.join(root, d.name)).filter(isMd);
			const newest = files.reduce((m, f) => {
				const t = fs.statSync(path.join(root, d.name, f)).mtime.toISOString();
				return t > m ? t : m;
			}, '');
			return { name: d.name, notes: files.length, updated_at: newest, company_id: links.get(d.name) ?? null };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function listNotes(client: string): NoteMeta[] {
	const dir = safe(client);
	if (!fs.existsSync(dir)) return [];
	const pins = notePins(client);
	return fs
		.readdirSync(dir)
		.filter(isMd)
		.map((file) => {
			const full = path.join(dir, file);
			const body = fs.readFileSync(full, 'utf8');
			return {
				file,
				title: file.replace(/\.md$/, ''),
				excerpt: body.replace(/^#.*$/m, '').replace(/[#*_>`\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140),
				updated_at: fs.statSync(full).mtime.toISOString(),
				pinned: pins.includes(file)
			};
		})
		// pinned first, in the order they were pinned; everything else newest first
		.sort((a, b) =>
			a.pinned !== b.pinned
				? Number(b.pinned) - Number(a.pinned)
				: a.pinned
					? pins.indexOf(a.file) - pins.indexOf(b.file)
					: b.updated_at.localeCompare(a.updated_at)
		);
}

export const readNote = (client: string, file: string) => fs.readFileSync(safe(client, file), 'utf8');
const mtimeOf = (p: string) => fs.statSync(p).mtime.toISOString();
export const noteMtime = (client: string, file: string) => mtimeOf(safe(client, file));

/**
 * Save a note; returns its new mtime, or null when `base` (the mtime the editor loaded) no longer matches
 * — the note changed elsewhere since (the other laptop), and writing would silently discard that.
 */
export function writeNote(client: string, file: string, body: string, base: string | null = null): string | null {
	if (!isMd(file)) throw new Error('not a .md file');
	fs.mkdirSync(safe(client), { recursive: true });
	const target = safe(client, file);
	let current: string | null = null;
	try {
		current = fs.readFileSync(target, 'utf8');
	} catch {
		/* new file */
	}
	if (current !== null && base && mtimeOf(target) !== base) return null;
	// unchanged -> no write: the list shows mtime as the note's date
	if (current === body) return mtimeOf(target);
	// temp file + rename: a crash mid-write leaves the old note whole, never a truncated one. Dot-named,
	// so the note list never shows it.
	const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
	fs.writeFileSync(tmp, body, 'utf8');
	fs.renameSync(tmp, target);
	return mtimeOf(target);
}

// new note: "YYYY-MM-DD Title.md", de-duped
export function createNote(client: string, title: string): string {
	const clean = cleanName(title) || 'Untitled';
	const base = `${ymd()} ${clean}`;
	let file = `${base}.md`;
	for (let i = 2; fs.existsSync(safe(client, file)); i++) file = `${base} ${i}.md`;
	writeNote(client, file, `# ${clean}\n\n`);
	return file;
}

// images/files dropped into a note -> NOTES_DIR/<client>/attachments/<name> (Obsidian sees them too)
const ATTACH = 'attachments';
export function saveAttachment(client: string, name: string, data: string): string {
	const clean = cleanName(name) || `image-${Date.now()}.png`;
	fs.mkdirSync(safe(client, ATTACH), { recursive: true });
	let file = clean;
	const [stem, ext] = clean.match(/^(.*?)(\.[^.]*)?$/)!.slice(1);
	for (let i = 2; fs.existsSync(safe(client, ATTACH, file)); i++) file = `${stem} ${i}${ext ?? ''}`;
	fs.writeFileSync(safe(client, ATTACH, file), Buffer.from(data, 'base64'));
	return `${ATTACH}/${file}`;
}
export function attachmentPath(client: string, rel: string): string | null {
	if (rel.includes('..')) return null;
	const p = safe(client, rel);
	return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

export function createClient(name: string): string {
	const folder = cleanName(name);
	fs.mkdirSync(safe(folder), { recursive: true });
	return folder;
}

// company -> folder: the manual (or auto) link wins, else a unique name match.
// `folders` = vault folder names; pass them in when calling in a loop (listClients() stats every note file)
// folder names only: one directory read. (It used to go through listClients(), which also stats every
// note in every folder — on each board load and refresh, just to get the names.)
export function folderNames(): string[] {
	const root = ROOT();
	if (!fs.existsSync(root)) return [];
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('.'))
		.map((d) => d.name);
}
export function folderForCompany(companyId: string | null, companyName: string | null, folders = folderNames()): string | null {
	if (!companyId) return null;
	const linked = (db.prepare('SELECT notes_dir FROM companies WHERE id = ?').get(companyId) as { notes_dir: string | null } | undefined)?.notes_dir;
	if (linked) return linked;
	return companyName ? uniqueMatch(companyName, folders) : null;
}

// soft delete: move into NOTES_DIR/.trash/<name>-<timestamp>. Never rm.
function toTrash(rel: string[]) {
	const src = safe(...rel);
	if (!fs.existsSync(src)) return;
	const trash = safe('.trash');
	fs.mkdirSync(trash, { recursive: true });
	const stamp = nowIso().replace(/[:.]/g, '-');
	fs.renameSync(src, path.join(trash, `${rel.join('__')}-${stamp}`));
}

export function deleteNote(client: string, file: string) {
	if (!isMd(file)) throw new Error('not a .md file');
	toTrash([client, file]);
	setNotePin(client, file, false); // a trashed note keeps no pin
}

export function deleteClient(name: string) {
	toTrash([name]);
	db.prepare('UPDATE companies SET notes_dir = NULL WHERE notes_dir = ?').run(name);
}

export const linkCompanyFolder = (companyId: string, folder: string | null) =>
	db.prepare('UPDATE companies SET notes_dir = ? WHERE id = ?').run(folder, companyId);

// ---- client hub: folders ∪ companies with tickets, keyed by folder name

// virtual: a company with tickets and no vault folder yet — the folder is made on its first note
export type HubClient = Client & { company_name: string | null; open: number; virtual?: boolean };


/**
 * Reading the clients list used to *write*: it auto-linked folder → company in `companies.notes_dir`,
 * on a GET, matching folder-to-company while the board matched company-to-folder — two directions that
 * could disagree on odd names. Now it only reads, and pairs the same way the board does
 * (`folderForCompany`: an explicit link, else one unambiguous name match). Links are still persisted,
 * but only where someone asks for one — `POST /api/clients/link` and creating a note for a company.
 */
export function listHubClients(): HubClient[] {
	const folders = listClients();
	const byFolder = new Map(folders.map((f) => [f.name, f]));
	// every company, with how many tickets it has at all and how many are still open
	const companies = db
		.prepare(
			`SELECT c.id, c.name, c.notes_dir,
			        COALESCE(SUM(t.status != 'done'), 0) AS open,
			        COUNT(t.id) AS tickets
			 FROM companies c LEFT JOIN tasks t ON t.company_id = c.id GROUP BY c.id`
		)
		.all() as { id: string; name: string; notes_dir: string | null; open: number; tickets: number }[];
	const names = folders.map((f) => f.name);
	const out = new Map<string, HubClient>();
	for (const f of folders) out.set(f.name, { ...f, company_name: null, open: 0 });
	for (const c of companies) {
		const folder = c.notes_dir ?? uniqueMatch(c.name, names);
		if (folder && byFolder.has(folder)) {
			const h = out.get(folder)!;
			h.company_id = c.id;
			h.company_name = c.name;
			h.open = c.open;
		} else if (c.tickets > 0) {
			// company with tickets but no folder yet: virtual entry, folder created with its first note
			out.set(c.name, { name: c.name, notes: 0, updated_at: '', company_id: c.id, company_name: c.name, open: c.open, virtual: true });
		}
	}
	return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
