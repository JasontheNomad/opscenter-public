<script lang="ts">
	// CodeMirror 6 markdown editor. Headings colored + sized per level (Obsidian-ish).
	import { onMount } from 'svelte';
	import { EditorView, drawSelection, keymap } from '@codemirror/view';
	import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
	import { EditorState } from '@codemirror/state';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { tags as t } from '@lezer/highlight';
	import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
	import { pastedFiles } from '$lib/attachments';
	import { liveMarks } from '$lib/mdMarks';

	// value: initial document (read once at mount). onfiles: dropped/pasted files -> markdown to insert at the cursor (e.g. image links).
	// onlink: note titles offered after `[[` (typing filters them; Enter completes the `[[Title]]`).
	// onwiki / onhref: a rendered `[[Note]]` / `[text](url)` was clicked (only on a line the cursor isn't on — there it's
	// text to edit). imageUrl: where an image's src, as written in the note, is served from (relative paths -> the app).
	// line: put the cursor there (1-based) and scroll it into view — at mount, and again whenever it changes
	let { value, line, onchange, onfiles, onlink, onwiki, onhref, imageUrl }: {
		value: string;
		line?: number;
		onchange: (v: string) => void;
		onfiles?: (files: File[]) => Promise<string>;
		onlink?: () => Promise<string[]>;
		onwiki?: (name: string) => void;
		onhref?: (url: string) => void;
		imageUrl?: (src: string) => string;
	} = $props();

	// mousedown, not click: the press must not move the cursor onto the line, which would turn the link back into text
	const linkClicks = EditorView.domEventHandlers({
		mousedown(e, view) {
			if (e.button !== 0) return false;
			const el = (e.target as Element).closest<HTMLElement>('.cm-wikilink, .cm-link, .cm-table');
			if (!el) return false;
			// a rendered table: put the cursor at it, which shows it as text to edit
			if (el.classList.contains('cm-table')) {
				const pos = view.posAtDOM(el);
				view.dispatch({ selection: { anchor: pos } });
				view.focus();
				e.preventDefault();
				return true;
			}
			if (el.dataset.wiki && onwiki) onwiki(el.dataset.wiki);
			else if (el.dataset.href && onhref) onhref(el.dataset.href);
			else return false;
			e.preventDefault();
			return true;
		}
	});

	async function wikiLinks(ctx: CompletionContext) {
		const m = onlink && ctx.matchBefore(/\[\[([^\]\n]*)$/);
		if (!m) return null;
		const titles = await onlink!();
		// from: after the `[[`, so what's typed there is matched against the titles, not the brackets
		return { from: m.from + 2, options: titles.map((t) => ({ label: t, apply: `${t}]]` })), validFor: /^[^\]\n]*$/ };
	}

	async function insertFiles(files: File[], pos: number) {
		if (!onfiles || !files.length) return;
		const docBefore = view.state.doc.toString();
		const md = await onfiles(files);
		if (!md) return;
		// doc changed during the upload (edit, or another note loaded) -> drop at the cursor instead of a stale offset
		const at = view.state.doc.toString() === docBefore ? pos : view.state.selection.main.head;
		const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length));
		const insert = (line.from === line.to ? '' : '\n') + md + '\n';
		view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length } });
		view.focus();
	}
	const fileEvents = EditorView.domEventHandlers({
		drop(e, v) {
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (!files.length) return false;
			e.preventDefault();
			const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
			void insertFiles(files, pos);
			return true;
		},
		paste(e, v) {
			const files = pastedFiles(e);
			if (!files.length) return false;
			e.preventDefault();
			void insertFiles(files, v.state.selection.main.head);
			return true;
		}
	});

	let host: HTMLDivElement;
	let view: EditorView;

	const highlight = HighlightStyle.define([
		{ tag: t.heading1, color: 'var(--md-h1)', fontSize: '1.6em', fontWeight: '700', lineHeight: '1.3' },
		{ tag: t.heading2, color: 'var(--md-h2)', fontSize: '1.35em', fontWeight: '700', lineHeight: '1.3' },
		{ tag: t.heading3, color: 'var(--md-h3)', fontSize: '1.2em', fontWeight: '600' },
		{ tag: t.heading4, color: 'var(--md-h4)', fontSize: '1.1em', fontWeight: '600' },
		{ tag: t.heading5, color: 'var(--md-h5)', fontSize: '1em', fontWeight: '600' },
		{ tag: t.heading6, color: 'var(--color-muted)', fontWeight: '600' },
		{ tag: t.processingInstruction, color: 'var(--color-muted)' }, // the # marks, ** etc
		{ tag: t.strong, fontWeight: '700', color: 'var(--md-strong)' },
		{ tag: t.emphasis, fontStyle: 'italic' },
		{ tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--color-muted)' },
		{ tag: t.link, color: 'var(--color-accent)', textDecoration: 'underline' },
		{ tag: t.url, color: 'var(--color-accent)' },
		{ tag: t.monospace, color: 'var(--md-code)', fontFamily: 'var(--font-mono)' },
		{ tag: t.quote, color: 'var(--color-muted)', fontStyle: 'italic' },
		{ tag: t.contentSeparator, color: 'var(--color-border-2)' }
	]);

	const theme = EditorView.theme(
		{
			'&': { height: '100%', fontSize: 'calc(14px * var(--text-scale, 1))', backgroundColor: 'transparent', color: 'var(--color-text)' },
			'.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.65', padding: '1.25rem 2rem' },
			'.cm-content': { maxWidth: '76ch', caretColor: 'var(--color-text)' },
			'.cm-line': { padding: '0' },
			'&.cm-focused': { outline: 'none' },
			'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)' },
			'.cm-cursor': { borderLeftColor: 'var(--color-text)' },
			'.cm-wikilink, .cm-link': { color: 'var(--color-accent)', textDecoration: 'underline', cursor: 'pointer' },
			'.cm-table': { borderCollapse: 'collapse', margin: '.3em 0', cursor: 'text' },
			'.cm-table th, .cm-table td': { border: '1px solid var(--color-border-2)', padding: '.25em .7em', textAlign: 'left', verticalAlign: 'top' },
			'.cm-table th': { background: 'var(--color-surface-2)', fontWeight: '600' },
			'.cm-image': { display: 'inline-block', maxWidth: '100%', maxHeight: '24rem', verticalAlign: 'middle', borderRadius: '6px', border: '1px solid var(--color-border)', cursor: 'zoom-in' },
			'.cm-tooltip': { backgroundColor: 'var(--color-surface-2)', border: '1px solid var(--color-border-2)', color: 'var(--color-text)', borderRadius: '6px' },
			'.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px', fontFamily: 'var(--font-sans)' },
			'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)', color: 'var(--color-text)' }
		},
		{ dark: true }
	);

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					// deliberately not `basicSetup`: it brings line numbers, a fold gutter and an active-line
					// highlight, which read as a code editor. These notes are prose. Only what typing needs.
					history(),
					drawSelection(),
					autocompletion({ override: [wikiLinks], icons: false }),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					markdown({ base: markdownLanguage }),
					syntaxHighlighting(highlight),
					liveMarks({ imageUrl: (src) => imageUrl?.(src) ?? src }), // marks show on the cursor's line only; images render (lib/mdMarks.ts)
					theme,
					EditorView.lineWrapping,
					fileEvents,
					linkClicks,
					// Brave's own spellcheck (CodeMirror turns it off by default). Grammarly is kept out: it
					// rewrites the page text behind CodeMirror's back and its fixes land mid-word.
					EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false' }),
					EditorView.updateListener.of((u) => u.docChanged && onchange(u.state.doc.toString()))
				]
			})
		});
		return () => view.destroy();
	});
	$effect(() => {
		if (!line || !view) return;
		const l = view.state.doc.line(Math.min(line, view.state.doc.lines));
		view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
		view.focus();
	});
	// `value` is the starting document only. To load another document, re-create the component
	// ({#key}): swapping text into a live editor puts the old document in the undo history and fires
	// `onchange`, which autosaved it.
</script>

<div bind:this={host} class="h-full min-h-0 overflow-hidden"></div>
