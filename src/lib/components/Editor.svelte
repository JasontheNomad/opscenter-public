<script lang="ts">
	// CodeMirror 6 markdown editor. Headings colored + sized per level (Obsidian-ish).
	import { onMount } from 'svelte';
	import { EditorView, drawSelection, keymap } from '@codemirror/view';
	import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
	import { EditorState } from '@codemirror/state';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
	import { tags as t } from '@lezer/highlight';
	import { pastedFiles } from '$lib/attachments';

	// value: initial document (read once at mount). onfiles: dropped/pasted files -> markdown to insert at the cursor (e.g. image links)
	let { value, onchange, onfiles }: { value: string; onchange: (v: string) => void; onfiles?: (files: File[]) => Promise<string> } = $props();

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
			'.cm-cursor': { borderLeftColor: 'var(--color-text)' }
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
					keymap.of([...defaultKeymap, ...historyKeymap]),
					markdown({ base: markdownLanguage }),
					syntaxHighlighting(highlight),
					theme,
					EditorView.lineWrapping,
					fileEvents,
					// Brave's own spellcheck (CodeMirror turns it off by default). Grammarly is kept out: it
					// rewrites the page text behind CodeMirror's back and its fixes land mid-word.
					EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false' }),
					EditorView.updateListener.of((u) => u.docChanged && onchange(u.state.doc.toString()))
				]
			})
		});
		return () => view.destroy();
	});
	// `value` is the starting document only. To load another document, re-create the component
	// ({#key}): swapping text into a live editor puts the old document in the undo history and fires
	// `onchange`, which autosaved it.
</script>

<div bind:this={host} class="h-full min-h-0 overflow-hidden"></div>
