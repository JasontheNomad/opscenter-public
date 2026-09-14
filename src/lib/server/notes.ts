// Markdown notes on disk. NOTES_DIR/<folder…>/<note>.md — same files Obsidian edits. A folder is a path
// relative to the vault root; client folders are `<CLIENTS>/<client>` ($lib/notes/vault.ts).
import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { db, meta } from './db';
import { errMsg } from '$lib/api';
import { ymd, nowIso } from '$lib/dates';
import { cleanName, uniqueMatch } from './names';
import { CLIENTS, clientOf, leaf } from '$lib/notes/vault';

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

// open = open tickets of the folder's company; only client folders have a company
export type Folder = { path: string; name: string; depth: number; notes: number; company_id: string | null; company_name: string | null; open: number };
export type NoteMeta = { folder: string; file: string; title: string; excerpt: string; updated_at: string; pinned: boolean };

// Pinned notes, per folder: { "<folder>": ["a.md", "b.md"] } in meta. Pinning is a view
// preference, not part of the vault — a note carries no marker on disk, so Obsidian or any other
// editor sees an ordinary file.
const PINS = 'note_pins';
const allPins = () => meta.json<Record<string, string[]>>(PINS, {});
export const notePins = (folder: string): string[] => allPins()[folder] ?? [];
export function setNotePin(folder: string, file: string, pinned: boolean) {
	const all = allPins();
	const next = (all[folder] ?? []).filter((f) => f !== file);
	if (pinned) next.push(file);
	if (next.length) all[folder] = next;
	else delete all[folder];
	meta.setJson(PINS, all);
}

// images/files dropped into a note -> <folder>/attachments/<name>. App-managed, so the folder tree leaves them out.
const ATTACH = 'attachments';
const isMd = (f: string) => f.endsWith('.md') && !f.startsWith('.');
// a note's first `# heading` names it; a note without one goes by its file name
const titleOf = (file: string, body: string) => body.match(/^# +(.+?)\s*$/m)?.[1] ?? file.replace(/\.md$/, '');
const mtimeOf = (p: string) => fs.statSync(p).mtime.toISOString();

// a directory's visible subfolders, by name
const subdirs = (dir: string) =>
	fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== ATTACH)
		.map((d) => d.name)
		.sort((a, b) => a.localeCompare(b));

/** Every folder under `under` ('' = the whole vault), parents before children, siblings by name. */
export function folderPaths(under = ''): string[] {
	const dir = safe(under);
	if (!fs.existsSync(dir)) return [];
	return subdirs(dir).flatMap((name) => {
		const p = under ? `${under}/${name}` : name;
		return [p, ...folderPaths(p)];
	});
}

/** Client folder names (the subfolders of CLIENTS): one directory read. */
export function clientNames(): string[] {
	const dir = safe(CLIENTS);
	return fs.existsSync(dir) ? subdirs(dir) : [];
}

/**
 * The folder tree for the Vault page, each client folder with its HubSpot company and open tickets.
 * Reading it never writes: company ↔ folder pairs the same way the board does (`folderForCompany`: an
 * explicit link, else one unambiguous name match). Links are persisted only where someone asks for one —
 * `POST /api/clients/link`, or a folder made for a company.
 */
export function listFolders(): Folder[] {
	const paths = folderPaths();
	const clients = clientNames();
	const companies = db
		.prepare(
			`SELECT c.id, c.name, c.notes_dir, COALESCE(SUM(t.status != 'done'), 0) AS open
			 FROM companies c LEFT JOIN tasks t ON t.company_id = c.id GROUP BY c.id`
		)
		.all() as { id: string; name: string; notes_dir: string | null; open: number }[];
	const byClient = new Map<string, { id: string; name: string; open: number }>();
	for (const c of companies) {
		const name = c.notes_dir ?? uniqueMatch(c.name, clients);
		if (name && clients.includes(name)) byClient.set(name, c);
	}
	return paths.map((p) => {
		const client = clientOf(p);
		const c = client === null ? undefined : byClient.get(client);
		return {
			path: p,
			name: leaf(p),
			depth: p.split('/').length - 1,
			notes: fs.readdirSync(safe(p)).filter(isMd).length,
			company_id: c?.id ?? null,
			company_name: c?.name ?? null,
			open: c?.open ?? 0
		};
	});
}

/** A folder's notes; `deep` adds the notes of every folder below it, each carrying its own folder. */
export function listNotes(folder: string, deep = false): NoteMeta[] {
	if (!fs.existsSync(safe(folder))) return [];
	const pins = allPins();
	const pinsOf = (f: string) => pins[f] ?? [];
	return [folder, ...(deep ? folderPaths(folder) : [])]
		.flatMap((f) =>
			fs
				.readdirSync(safe(f))
				.filter(isMd)
				.map((file) => {
					const full = safe(f, file);
					const body = fs.readFileSync(full, 'utf8');
					return {
						folder: f,
						file,
						title: titleOf(file, body),
						excerpt: body.replace(/^#.*$/m, '').replace(/[#*_>`\-[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140),
						updated_at: mtimeOf(full),
						pinned: pinsOf(f).includes(file)
					};
				})
		)
		// pinned first, in the order they were pinned; everything else newest first
		.sort((a, b) =>
			a.pinned !== b.pinned
				? Number(b.pinned) - Number(a.pinned)
				: a.pinned
					? pinsOf(a.folder).indexOf(a.file) - pinsOf(b.folder).indexOf(b.file)
					: b.updated_at.localeCompare(a.updated_at)
		);
}

export type NoteHit = { client: string; file: string; title: string; line: number; text: string };

/**
 * Full-text search across every folder's notes. A line matches when it contains every word of the
 * query (case-insensitive, any order). Reads each file once; capped at `perFile` hits per note and
 * `max` overall — the vault is small enough that a walk beats keeping an index in sync with Obsidian.
 * `client` on a hit is the note's folder path.
 */
export function searchNotes(query: string, perFile = 5, max = 200): NoteHit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const hits: NoteHit[] = [];
	for (const folder of folderPaths()) {
		const dir = safe(folder);
		for (const file of fs.readdirSync(dir).filter(isMd)) {
			let n = 0;
			const body = fs.readFileSync(path.join(dir, file), 'utf8');
			const lines = body.split('\n');
			for (let i = 0; i < lines.length && n < perFile; i++) {
				const lower = lines[i].toLowerCase();
				if (!words.every((w) => lower.includes(w))) continue;
				hits.push({ client: folder, file, title: titleOf(file, body), line: i + 1, text: lines[i].trim().slice(0, 200) });
				n++;
				if (hits.length >= max) return hits;
			}
		}
	}
	return hits;
}

export type NoteRef = { client: string; file: string };

/**
 * Where an Obsidian wiki-link `[[Name]]` points, per name. `Name` may carry `.md`, a `#heading`
 * (dropped) or a `Folder/Name` prefix: only folders whose path is, or ends in, that prefix — so
 * `[[Acme/Note]]` still finds `<CLIENTS>/Acme`. Lookup, case-insensitive: the note's own folder
 * first, then every folder in tree order — the first hit wins. Unknown names map to null; the editor
 * leaves those as text.
 */
export function resolveNotes(client: string, names: string[]): Record<string, NoteRef | null> {
	const folders = folderPaths();
	const files = new Map<string, string[]>(); // folder -> its .md files, read once
	const filesIn = (folder: string) => {
		if (!files.has(folder)) files.set(folder, fs.existsSync(safe(folder)) ? fs.readdirSync(safe(folder)).filter(isMd) : []);
		return files.get(folder)!;
	};
	const find = (folder: string, name: string) => filesIn(folder).find((f) => f.toLowerCase() === `${name}.md`.toLowerCase());
	const out: Record<string, NoteRef | null> = {};
	for (const raw of names) {
		let name = raw.split('#')[0].trim().replace(/\.md$/i, '');
		let where = [client, ...folders.filter((f) => f !== client)];
		const slash = name.lastIndexOf('/');
		if (slash >= 0) {
			const want = name.slice(0, slash).toLowerCase();
			where = folders.filter((f) => f.toLowerCase() === want || f.toLowerCase().endsWith(`/${want}`));
			name = name.slice(slash + 1);
		}
		out[raw] = null;
		if (!name || name.includes('..')) continue;
		for (const folder of where) {
			const file = find(folder, name);
			if (file) { out[raw] = { client: folder, file }; break; }
		}
	}
	return out;
}

export const readNote = (folder: string, file: string) => fs.readFileSync(safe(folder, file), 'utf8');
export const noteMtime = (folder: string, file: string) => mtimeOf(safe(folder, file));

/**
 * Save a note; returns its new mtime, or null when `base` (the mtime the editor loaded) no longer matches
 * — the note changed elsewhere since (the other laptop), and writing would silently discard that.
 */
export function writeNote(folder: string, file: string, body: string, base: string | null = null): string | null {
	if (!isMd(file)) throw new Error('not a .md file');
	fs.mkdirSync(safe(folder), { recursive: true });
	const target = safe(folder, file);
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

// new note: "YYYY-MM-DD Title.md", de-duped. `body` goes under the heading; `day` is the date in the name.
export function createNote(folder: string, title: string, body = '', day = ymd()): string {
	const clean = cleanName(title) || 'Untitled';
	const base = `${day} ${clean}`;
	let file = `${base}.md`;
	for (let i = 2; fs.existsSync(safe(folder, file)); i++) file = `${base} ${i}.md`;
	writeNote(folder, file, `# ${clean}\n\n${body}`);
	return file;
}

// images/files dropped into a note -> NOTES_DIR/<folder>/attachments/<name> (Obsidian sees them too)
export function saveAttachment(folder: string, name: string, data: string): string {
	const clean = cleanName(name) || `image-${Date.now()}.png`;
	fs.mkdirSync(safe(folder, ATTACH), { recursive: true });
	let file = clean;
	const [stem, ext] = clean.match(/^(.*?)(\.[^.]*)?$/)!.slice(1);
	for (let i = 2; fs.existsSync(safe(folder, ATTACH, file)); i++) file = `${stem} ${i}${ext ?? ''}`;
	fs.writeFileSync(safe(folder, ATTACH, file), Buffer.from(data, 'base64'));
	return `${ATTACH}/${file}`;
}
export function attachmentPath(folder: string, rel: string): string | null {
	if (rel.includes('..')) return null;
	// a bare name (Obsidian's `![[x.png]]`) may sit in the folder itself or in attachments/
	const candidates = rel.includes('/') ? [rel] : [rel, `${ATTACH}/${rel}`];
	for (const c of candidates) {
		const p = safe(folder, c);
		if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
	}
	return null;
}

/** New folder `name` inside `parent` ('' = the vault root); returns its path. */
export function createFolder(parent: string, name: string): string {
	const clean = cleanName(name);
	if (!clean || clean.startsWith('.') || clean === ATTACH) throw new Error(`can't name a folder "${name}"`);
	const folder = parent ? `${parent}/${clean}` : clean;
	fs.mkdirSync(safe(folder), { recursive: true });
	return folder;
}

// company -> its client folder path: the manual (or auto) link wins, else a unique name match. The
// name comes from the company row when the caller has none (getTask() carries no company_name).
// `names` = client folder names; pass them in when calling in a loop.
export function folderForCompany(companyId: string | null, companyName: string | null, names = clientNames()): string | null {
	if (!companyId) return null;
	const row = db.prepare('SELECT name, notes_dir FROM companies WHERE id = ?').get(companyId) as { name: string; notes_dir: string | null } | undefined;
	const name = row?.notes_dir || uniqueMatch(companyName ?? row?.name ?? '', names);
	return name ? `${CLIENTS}/${name}` : null;
}

// only a client folder links to a company; the company row keeps the bare client name
export function linkCompanyFolder(companyId: string, folder: string) {
	const client = clientOf(folder);
	if (!client) throw new Error(`only a folder directly inside ${CLIENTS} can link to a company`);
	db.prepare('UPDATE companies SET notes_dir = ? WHERE id = ?').run(client, companyId);
}

/**
 * A client folder, named after the company and linked to it, for each of these companies that has none.
 * Sync calls it for the companies of newly mirrored tickets only, so a folder deleted on purpose comes
 * back only with that company's next new ticket. Never throws: a folder is a convenience, not worth a
 * failed sync.
 */
export function ensureClientFolders(companyIds: string[]) {
	if (!env.NOTES_DIR || !companyIds.length) return;
	try {
		const names = clientNames();
		const nameOf = db.prepare('SELECT name FROM companies WHERE id = ?').pluck();
		for (const id of new Set(companyIds)) {
			const company = nameOf.get(id) as string | undefined;
			if (!company || folderForCompany(id, company, names)) continue;
			try {
				const folder = createFolder(CLIENTS, company);
				linkCompanyFolder(id, folder);
				names.push(leaf(folder));
			} catch (e) {
				console.warn(`[vault] no client folder for company ${id}:`, errMsg(e).slice(0, 160));
			}
		}
	} catch (e) {
		console.warn('[vault] client folders skipped:', errMsg(e).slice(0, 160));
	}
}

/**
 * One time: client folders used to be the vault's top level. Move them all under CLIENTS, re-key
 * their pins, then give every company with tickets a folder, as its next ticket would. A meta flag, not
 * the folder's existence, marks it done — so deleting or renaming the clients folder later never sweeps other
 * top-level folders (Personal, …) into it.
 */
const NESTED = 'vault_clients_nested';
export function nestClientFolders() {
	if (!env.NOTES_DIR || meta.get(NESTED)) return;
	const root = ROOT();
	if (fs.existsSync(root)) {
		fs.mkdirSync(safe(CLIENTS), { recursive: true });
		for (const name of subdirs(root).filter((n) => n !== CLIENTS)) {
			if (fs.existsSync(safe(CLIENTS, name))) console.warn(`[vault] "${name}" is already inside ${CLIENTS}; left at the top`);
			else fs.renameSync(safe(name), safe(CLIENTS, name));
		}
		// re-key by where the folder is now, so a run cut short and started again still gets every pin
		const moved = (f: string) => !f.includes('/') && !fs.existsSync(safe(f)) && fs.existsSync(safe(CLIENTS, f));
		meta.setJson(PINS, Object.fromEntries(Object.entries(allPins()).map(([f, files]) => [moved(f) ? `${CLIENTS}/${f}` : f, files])));
	}
	meta.set(NESTED, nowIso());
	ensureClientFolders(db.prepare('SELECT DISTINCT company_id FROM tasks WHERE company_id IS NOT NULL').pluck().all() as string[]);
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

export function deleteNote(folder: string, file: string) {
	if (!isMd(file)) throw new Error('not a .md file');
	toTrash([...folder.split('/'), file]);
	setNotePin(folder, file, false); // a trashed note keeps no pin
}

export function deleteFolder(folder: string) {
	if (!folder || folder === CLIENTS) throw new Error(`won't trash ${folder || 'the vault'}`);
	toTrash(folder.split('/'));
	const client = clientOf(folder);
	if (client) db.prepare('UPDATE companies SET notes_dir = NULL WHERE notes_dir = ?').run(client);
}
