// Live markdown: the syntax marks (`#`, `**`, `` ` ``, `~~`, link targets, `[[ ]]`) disappear on every
// line the cursor isn't on, the way Obsidian's editor reads. The text underneath is untouched — the
// marks are only hidden from view, so the file stays plain markdown and the cursor line shows it all.
import { EditorView, Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { isRecordingSrc } from './recordings';

const hide = Decoration.replace({});
const wikiLink = (name: string) => Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-wiki': name } });
const link = (href: string) => Decoration.mark({ class: 'cm-link', attributes: { 'data-href': href } });
const MARKS = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark']);
const WIKI = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
// Obsidian image embed; same extensions the preview accepts
const IMG_EMBED = /!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg))(?:\|([^\]]*))?\]\]/gi;

// `![alt](src)` off the cursor line is the picture itself. `data-zoom`: the page's Lightbox opens it on click.
class ImageWidget extends WidgetType {
	constructor(readonly src: string, readonly alt: string) { super(); }
	eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt; }
	toDOM(view: EditorView) {
		const img = view.dom.ownerDocument.createElement('img');
		img.src = this.src;
		img.alt = this.alt;
		img.className = 'cm-image';
		img.setAttribute('data-zoom', '');
		return img;
	}
}

// line numbers a selection touches: those lines show their marks
function activeLines(state: EditorState): Set<number> {
	const doc = state.doc;
	const active = new Set<number>();
	for (const r of state.selection.ranges)
		for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) active.add(l);
	return active;
}

/** Ranges to hide in `from`–`to`, skipping any line a selection touches. Sorted, non-overlapping. */
export function hiddenMarks(state: EditorState, from: number, to: number): { from: number; to: number }[] {
	const doc = state.doc;
	const active = activeLines(state);
	const out: { from: number; to: number }[] = [];
	const add = (a: number, b: number) => {
		if (b > a && !active.has(doc.lineAt(a).number)) out.push({ from: a, to: b });
	};
	syntaxTree(state).iterate({
		from,
		to,
		enter(n) {
			if (MARKS.has(n.name)) {
				// `# ` — the space after a heading mark goes too, or the heading text sits one space in
				add(n.from, n.name === 'HeaderMark' && doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to);
			} else if (n.name === 'CodeMark' && n.node.parent?.name === 'InlineCode') {
				add(n.from, n.to);
			} else if (n.name === 'LinkMark' && n.node.parent?.name === 'Autolink') {
				add(n.from, n.to); // `<url>` reads as the url
			} else if (n.name === 'Link') {
				// `[text](url "title")` reads as `text`. A `[ref]` link (which is also how the parser sees the
				// inside of `[[Note]]`) has no target here: left alone. Images and `<autolinks>` aren't Links.
				const open = n.node.getChildren('LinkMark').find((m) => doc.sliceString(m.from, m.to) === '(');
				if (!open) return;
				add(n.from, n.from + 1);
				add(open.from - 1, n.to);
			}
		}
	});
	// `[[Note]]` and `[[Note|label]]` aren't markdown to the parser: hide the brackets, and for a label the
	// target and `|` too, so only the label reads
	for (const m of doc.sliceString(from, to).matchAll(WIKI)) {
		const s = from + m.index;
		add(s, s + 2);
		if (m[2] !== undefined) add(s + 2, s + 2 + m[1].length + 1);
		add(s + m[0].length - 2, s + m[0].length);
	}
	return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The visible part of each `[[Note]]` / `[[Note|label]]` on a line the cursor isn't on, with the note name. */
export function wikiLinks(state: EditorState, from: number, to: number): { from: number; to: number; name: string }[] {
	const doc = state.doc;
	const active = activeLines(state);
	const out: { from: number; to: number; name: string }[] = [];
	for (const m of doc.sliceString(from, to).matchAll(WIKI)) {
		const s = from + m.index;
		if (active.has(doc.lineAt(s).number)) continue;
		const start = m[2] === undefined ? s + 2 : s + 2 + m[1].length + 1;
		out.push({ from: start, to: s + m[0].length - 2, name: m[1].trim() });
	}
	return out;
}

/** Clickable text of each `[text](url)`, `<url>` and bare url on a line the cursor isn't on, with its target. */
export function links(state: EditorState, from: number, to: number): { from: number; to: number; href: string }[] {
	const doc = state.doc;
	const active = activeLines(state);
	const out: { from: number; to: number; href: string }[] = [];
	syntaxTree(state).iterate({
		from,
		to,
		enter(n) {
			if (active.has(doc.lineAt(n.from).number)) return;
			if (n.name === 'Link') {
				const url = n.node.getChild('URL');
				const close = n.node.getChildren('LinkMark')[1]; // the `]`
				if (url && close) out.push({ from: n.from + 1, to: close.from, href: doc.sliceString(url.from, url.to) });
			} else if (n.name === 'URL' && n.node.parent?.name !== 'Link' && n.node.parent?.name !== 'Image') {
				out.push({ from: n.from, to: n.to, href: doc.sliceString(n.from, n.to) });
			}
		}
	});
	return out;
}

/** Each `![alt](src)` and `![[x.png]]` on a line the cursor isn't on: its whole range, to show as the picture. */
export function images(state: EditorState, from: number, to: number): { from: number; to: number; src: string; alt: string }[] {
	const doc = state.doc;
	const active = activeLines(state);
	const out: { from: number; to: number; src: string; alt: string }[] = [];
	syntaxTree(state).iterate({
		from,
		to,
		enter(n) {
			if (n.name !== 'Image' || active.has(doc.lineAt(n.from).number)) return;
			const url = n.node.getChild('URL');
			const close = n.node.getChildren('LinkMark')[1];
			if (url && close) out.push({ from: n.from, to: n.to, src: doc.sliceString(url.from, url.to), alt: doc.sliceString(n.from + 2, close.from) });
		}
	});
	for (const m of doc.sliceString(from, to).matchAll(IMG_EMBED)) {
		const s = from + m.index;
		if (!active.has(doc.lineAt(s).number)) out.push({ from: s, to: s + m[0].length, src: encodeURI(m[1].trim()), alt: m[2] ?? '' });
	}
	return out;
}

// ---- video: `<video src="/api/recordings/…" controls></video>` alone on a line is the player itself (a
// meeting recording note). Only OpsCenter's own recordings endpoint ($lib/recordings `isRecordingSrc`): a
// note is plain text, and the player must never load from anywhere else.
const VIDEO = /^\s*<video\s[^>]*?\bsrc="([^"]+)"[^>]*>\s*<\/video>\s*$/i;

class VideoWidget extends WidgetType {
	constructor(readonly src: string) { super(); }
	eq(o: VideoWidget) { return o.src === this.src; }
	toDOM(view: EditorView) {
		const v = view.dom.ownerDocument.createElement('video');
		v.src = this.src;
		v.className = 'cm-video';
		v.controls = true;
		v.preload = 'metadata';
		v.playsInline = true;
		Object.assign(v.style, { display: 'block', width: '100%', maxWidth: '960px', aspectRatio: '16 / 9', background: '#000', borderRadius: '6px' });
		return v;
	}
	ignoreEvent() { return true; } // the player's own controls get the clicks, not the editor
}

/** Each recording `<video>` line the cursor isn't on: its whole range, to show as the player. */
export function videos(state: EditorState, from: number, to: number): { from: number; to: number; src: string }[] {
	const doc = state.doc;
	const active = activeLines(state);
	const out: { from: number; to: number; src: string }[] = [];
	for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
		const line = doc.line(n);
		const m = VIDEO.exec(line.text);
		if (m && !active.has(n) && isRecordingSrc(m[1])) out.push({ from: line.from, to: line.to, src: m[1] });
	}
	return out;
}

// ---- tables: a GFM table no selection touches is shown as a real table

/** A cell's content: text, and bold / italic / code / strikethrough / link runs (marks dropped). */
export type Inline = string | { tag: 'strong' | 'em' | 'code' | 'del' | 'a'; href?: string; kids: Inline[] };
export type TableData = { from: number; to: number; align: ('left' | 'center' | 'right' | null)[]; rows: Inline[][][] };

const SKIP = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark', 'URL', 'LinkTitle']);
const WRAP: Record<string, Exclude<Inline, string>['tag']> = { StrongEmphasis: 'strong', Emphasis: 'em', InlineCode: 'code', Strikethrough: 'del', Link: 'a' };
const MARK_OF = { strong: 'EmphasisMark', em: 'EmphasisMark', code: 'CodeMark', del: 'StrikethroughMark', a: 'LinkMark' };
// the inline content of `node` between `from` and `to`, as nested runs
function inline(node: SyntaxNode, doc: Text, from: number, to: number): Inline[] {
	const out: Inline[] = [];
	const text = (a: number, b: number) => b > a && out.push(doc.sliceString(a, b));
	let at = from;
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.to <= from || c.from >= to) continue;
		text(at, c.from);
		const tag = WRAP[c.name];
		if (tag) {
			// the content sits inside the marks: for a link between `[` and `]`, otherwise between the first and the last
			const marks = c.getChildren(MARK_OF[tag]);
			const a = marks[0]?.to ?? c.from;
			const b = (tag === 'a' ? marks[1]?.from : marks[marks.length - 1]?.from) ?? c.to;
			const url = tag === 'a' ? c.getChild('URL') : null;
			out.push({ tag, ...(url ? { href: doc.sliceString(url.from, url.to) } : {}), kids: inline(c, doc, a, b) });
		} else if (!SKIP.has(c.name)) {
			text(c.from, c.to);
		}
		at = c.to;
	}
	text(at, to);
	return out;
}

/** Every table in `from`–`to` that no selection touches, as rows of cells (the first row is the header). */
export function tables(state: EditorState, from: number, to: number): TableData[] {
	const doc = state.doc;
	const active = activeLines(state);
	const out: TableData[] = [];
	syntaxTree(state).iterate({
		from,
		to,
		enter(n) {
			if (n.name !== 'Table') return;
			for (let l = doc.lineAt(n.from).number; l <= doc.lineAt(n.to).number; l++) if (active.has(l)) return false;
			const rows: Inline[][][] = [];
			let align: TableData['align'] = [];
			for (let row = n.node.firstChild; row; row = row.nextSibling) {
				if (row.name === 'TableDelimiter') {
					// `|:---|:---:|---:|` -> how each column aligns
					align = doc.sliceString(row.from, row.to).split('|').filter((c) => c.trim()).map((c) => {
						const t = c.trim();
						return t.startsWith(':') ? (t.endsWith(':') ? 'center' : 'left') : t.endsWith(':') ? 'right' : null;
					});
					continue;
				}
				if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
				// cells sit between the `|`s; an empty cell has no TableCell node, so go by the pipes
				const pipes = row.getChildren('TableDelimiter');
				const edges = [row.from, ...pipes.flatMap((p) => [p.from, p.to]), row.to];
				const cells: Inline[][] = [];
				for (let i = 0; i < edges.length; i += 2) {
					const [a, b] = [edges[i], edges[i + 1]];
					if (b <= a && (i === 0 || i === edges.length - 2)) continue; // nothing before the first / after the last pipe
					const cell = row.getChildren('TableCell').find((c) => c.from >= a && c.to <= b);
					cells.push(cell ? inline(cell, doc, cell.from, cell.to) : []);
				}
				rows.push(cells);
			}
			const width = Math.max(align.length, ...rows.map((r) => r.length));
			for (const r of rows) while (r.length < width) r.push([]);
			out.push({ from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to, align, rows });
			return false;
		}
	});
	return out;
}

class TableWidget extends WidgetType {
	constructor(readonly data: TableData, readonly src: string) { super(); }
	eq(o: TableWidget) { return o.src === this.src; }
	toDOM(view: EditorView) {
		const d = view.dom.ownerDocument;
		const render = (parent: HTMLElement, runs: Inline[]) => {
			for (const r of runs) {
				if (typeof r === 'string') parent.append(r);
				else {
					const el = d.createElement(r.tag);
					if (r.href) (el.className = 'cm-link'), el.setAttribute('data-href', r.href);
					render(el, r.kids);
					parent.append(el);
				}
			}
		};
		const table = d.createElement('table');
		table.className = 'cm-table';
		this.data.rows.forEach((row, i) => {
			const tr = table.appendChild(d.createElement('tr'));
			row.forEach((cell, j) => {
				const td = tr.appendChild(d.createElement(i === 0 ? 'th' : 'td'));
				if (this.data.align[j]) td.style.textAlign = this.data.align[j]!;
				render(td, cell);
			});
		});
		return table;
	}
	ignoreEvent() { return false; } // clicks reach the editor: it puts the cursor in the table, which shows the text
}

// Tables are block widgets, and CodeMirror accepts those only from a state field. Given by the view plugin
// they threw "Block decorations may not be specified via plugins", which broke the editor on any table
// (pasting one dropped the paste).
const tableDecos = (state: EditorState): DecorationSet =>
	Decoration.set(tables(state, 0, state.doc.length).map((t) => Decoration.replace({ widget: new TableWidget(t, state.doc.sliceString(t.from, t.to)), block: true }).range(t.from, t.to)));
const tableField = StateField.define<DecorationSet>({
	create: tableDecos,
	update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? tableDecos(tr.state) : deco),
	provide: (f) => EditorView.decorations.from(f)
});

/** `imageUrl`: where an image's `src` (as written in the note) is actually served from. */
export const liveMarks = (opts: { imageUrl: (src: string) => string }): Extension => {
	const build = (view: EditorView): DecorationSet => {
		const all = view.visibleRanges.flatMap(({ from, to }) => {
			// a table replaces its whole block (tableField draws it): nothing else may decorate inside it
			const tbl = tables(view.state, from, to);
			const outside = (r: { from: number }) => !tbl.some((t) => r.from >= t.from && r.from < t.to);
			return [
				...hiddenMarks(view.state, from, to).filter(outside).map((r) => hide.range(r.from, r.to)),
				...wikiLinks(view.state, from, to).filter(outside).map((r) => wikiLink(r.name).range(r.from, r.to)),
				...links(view.state, from, to).filter(outside).map((r) => link(r.href).range(r.from, r.to)),
				...images(view.state, from, to).filter(outside).map((r) => Decoration.replace({ widget: new ImageWidget(opts.imageUrl(r.src), r.alt) }).range(r.from, r.to)),
				...videos(view.state, from, to).filter(outside).map((r) => Decoration.replace({ widget: new VideoWidget(r.src) }).range(r.from, r.to))
			];
		});
		return Decoration.set(all, true);
	};
	return [
		tableField,
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(view: EditorView) {
					this.decorations = build(view);
				}
				update(u: ViewUpdate) {
					if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = build(u.view);
				}
			},
			{ decorations: (v) => v.decorations }
		)
	];
};
