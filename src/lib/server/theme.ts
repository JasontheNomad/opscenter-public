// Omarchy theme -> app palette. Maps an Omarchy colors.toml onto the `@theme` tokens in layout.css.
// Two sources: the theme on this machine (when the server runs on an Omarchy laptop), else the one the
// Omarchy laptop *pushes* to POST /api/theme (the VPS has no desktop of its own). It's applied only for
// Linux browsers (followsOmarchy) — the Mac keeps the built-in palette.
// Only structural, priority and markdown tokens follow the theme: presence, the Teams purple and
// the unread red are brand signals and stay fixed (Matte Black defines `green` as #FFC107, which
// would make "Available" yellow).
import { readFileSync, statSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { meta } from './db';

const STATE = join(homedir(), '.local/state/omarchy/current');
const COLORS = join(STATE, 'theme/colors.toml');

export type Theme = { name: string; mode: 'dark' | 'light'; css: string; bg: string; surface: string };

// Values are interpolated into a <style>, so nothing but a hex literal is accepted.
const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v);

/** Minimal reader for Omarchy's flat `key = "value"` colors.toml. */
function parse(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split('\n')) {
		const m = line.match(/^\s*([a-z_]+)\s*=\s*"([^"]*)"/);
		if (m) out[m[1]] = m[2];
	}
	return out;
}

/** app token -> colors.toml key. A key the theme omits leaves that token at its layout.css default. */
const MAP: Record<string, string> = {
	// Structural: five ascending steps. `background` is Omarchy's visible ground — the terminal and
	// the shell bar both paint it — so it lands on `surface` (panels, cards, the sidebar) and the
	// app's backdrop sits one step below it. Starting at `darker_background` read as near-black.
	'--color-bg': 'dark_background',
	'--color-surface': 'background',
	'--color-surface-2': 'lighter_background',
	'--color-border': 'selection',
	'--color-border-2': 'muted',
	'--color-text': 'foreground',
	'--color-muted': 'dark_foreground',
	'--color-accent': 'accent',
	// priority
	'--color-p-low': 'green',
	'--color-p-med': 'blue',
	'--color-p-high': 'orange',
	'--color-p-urgent': 'red',
	// markdown accents (editor + preview)
	'--md-h1': 'red',
	'--md-h2': 'yellow',
	'--md-h3': 'green',
	'--md-h4': 'magenta',
	'--md-h5': 'cyan',
	'--md-strong': 'yellow',
	'--md-code': 'cyan'
};

/** colors.toml values -> Theme, or null when it carries no usable hex colour. */
function build(c: Record<string, string>, name: string): Theme | null {
	// a key the theme omits (or writes as something other than a hex literal) is simply skipped,
	// leaving that token at its layout.css default
	const val = (token: string) => (isHex(c[MAP[token]] ?? '') ? c[MAP[token]] : '');
	const decls = Object.keys(MAP)
		.filter((token) => val(token))
		.map((token) => `${token}:${val(token)}`);
	if (!decls.length) return null;
	return {
		name,
		mode: c.mode === 'light' ? 'light' : 'dark',
		// `:root:root` outranks the `:root` Tailwind's @theme emits, whichever order they land in
		css: `:root:root{${decls.join(';')}}`,
		// PWA chrome: the window background, and the title bar, which matches the sidebar and the
		// window-controls-overlay strip — both paint `surface`
		bg: val('--color-bg'),
		surface: val('--color-surface')
	};
}

let cache: { at: number; theme: Theme | null } = { at: -1, theme: null };

// On the VPS there is no Omarchy, so the stat below threw on *every* request. Re-check now and then
// rather than never: a laptop install could gain a theme while the app is running.
const MISS_MS = 60_000;
let missAt = 0;

/** The theme on this machine's desktop, or null when this machine has no Omarchy. */
function localTheme(): Theme | null {
	if (missAt && Date.now() - missAt < MISS_MS) return null;
	let at: number;
	try {
		at = statSync(COLORS).mtimeMs;
		missAt = 0;
	} catch {
		missAt = Date.now();
		return null; // no Omarchy on this machine
	}
	if (at === cache.at) return cache.theme;
	let theme: Theme | null;
	try {
		theme = build(parse(readFileSync(COLORS, 'utf8')), readFileSync(join(STATE, 'theme.name'), 'utf8').trim());
	} catch {
		theme = null;
	}
	cache = { at, theme };
	return theme;
}

// last palette an Omarchy laptop pushed; loaded from meta once, then kept in step by setPushedTheme
type Pushed = { name: string; colors: Record<string, string> };
let pushed: Theme | null | undefined;

/** The active Omarchy theme: this machine's own, else the one the laptop pushed. */
export function omarchyTheme(): Theme | null {
	const local = localTheme();
	if (local) return local;
	if (pushed === undefined) {
		const p = meta.json<Pushed | null>('omarchy_theme', null);
		pushed = p ? build(p.colors, p.name) : null;
	}
	return pushed;
}

/** Store a colors.toml pushed from the Omarchy laptop. Throws if it holds no usable colour. */
export function setPushedTheme(name: string, toml: string): Theme {
	const colors = parse(toml);
	const theme = build(colors, name);
	if (!theme) throw new Error('no usable colours in that colors.toml');
	// keep only hex values (and mode): nothing else is ever read back
	const kept = Object.fromEntries(Object.entries(colors).filter(([k, v]) => k === 'mode' || isHex(v)));
	meta.setJson('omarchy_theme', { name, colors: kept } satisfies Pushed);
	pushed = theme;
	return theme;
}

/**
 * Whether this request's browser should wear the Omarchy palette. Omarchy is Linux; the Mac keeps
 * the built-in look. Chromium keeps the platform in its reduced user-agent ("X11; Linux x86_64").
 */
export function followsOmarchy(request: Request): boolean {
	const ua = request.headers.get('user-agent') ?? '';
	return /Linux/.test(ua) && !/Android/.test(ua);
}

let watching = false;

/**
 * Call `onChange` when the desktop theme changes. `omarchy theme set` moves a staged directory over
 * `theme` and only then writes `theme.name`, so the watch is on the parent (the `theme` inode is
 * replaced) and settles briefly before re-reading. No Omarchy on this machine -> no watcher.
 */
export function startThemeWatch(onChange: () => void) {
	if (watching) return;
	let timer: ReturnType<typeof setTimeout>;
	try {
		watch(STATE, (_type, file) => {
			if (file !== 'theme.name' && file !== 'theme') return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				const before = cache.theme?.css;
				if (localTheme()?.css !== before) onChange();
			}, 200);
		});
		watching = true;
	} catch {}
}
