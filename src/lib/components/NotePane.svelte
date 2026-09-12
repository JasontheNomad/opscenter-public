<!--
  One open note: the header (save state, preview toggle, optional delete), the editor, and the
  rendered preview. Shared by the Clients page and a note's own window (lib/notes/window.svelte.ts),
  so both behave identically — same autosave, same attachment upload, same sanitised preview.
-->
<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { browser } from '$app/environment';
	import Editor from './Editor.svelte';
	import { post } from '$lib/api';
	import { readFiles, mdLink, tooBig } from '$lib/attachments';
	import type { NoteSession } from '$lib/noteSession.svelte';

	let { note, client, ondelete }: { note: NoteSession; client: string; ondelete?: (file: string) => void } = $props();

	const enc = encodeURIComponent;
	let preview = $state(false);

	// relative image/link paths in the vault (attachments/x.png) -> served by the app
	const fileUrl = (rel: string) => `/api/notes/file?client=${enc(client)}&path=${enc(rel)}`;
	// marked passes raw inline HTML through -> sanitize before {@html} (notes can contain pasted client content)
	const html = $derived.by(() => {
		if (!preview || !browser) return '';
		const raw = (marked.parse(note.body) as string).replace(/(src|href)="(?!https?:|\/|#|mailto:|data:)([^"]+)"/g, (_, attr, rel) => {
			let p = rel;
			try { p = decodeURIComponent(rel); } catch { /* a path that isn't encoded */ }
			return `${attr}="${fileUrl(p)}"${attr === 'src' ? ' data-zoom' : ''}`;
		});
		return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
	});

	// drop/paste into the editor -> save into <client>/attachments -> markdown links
	async function uploadFiles(files: File[]): Promise<string> {
		const { atts, rejected } = await readFiles(files);
		if (rejected.length) alert(tooBig(rejected));
		if (!atts.length) return '';
		let saved: { name: string; rel: string }[];
		try {
			saved = await post(`/api/notes/attach`, { client, uploads: atts.map((a) => ({ name: a.name, type: a.type, data: a.data })) });
		} catch (e) {
			return (alert(`upload failed: ${e}`), '');
		}
		// encodeURI: marked rejects bare destinations with spaces (macOS screenshot names); Obsidian reads both
		return saved.map((f) => mdLink(f.name, encodeURI(f.rel))).join('\n');
	}
</script>

<div class="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4 text-caption text-muted">
	<span class="truncate">{note.file.replace(/\.md$/, '')}</span>
	<span class="flex-1"></span>
	{#if note.error}
		<span class="min-w-0 truncate text-p-urgent" title={note.error}>Not saved: {note.error}</span>
		<button class="shrink-0 underline hover:text-text" onclick={() => note.save()}>Retry</button>
	{:else}
		<span>{note.saved ? 'Saved' : 'Saving…'}</span>
	{/if}
	<button class="rounded-md border border-border px-2 py-0.5 {preview ? 'bg-surface-2 text-text' : ''} hover:text-text" onclick={() => (preview = !preview)}>{preview ? 'Edit' : 'Preview'}</button>
	{#if ondelete}
		<button class="hover:text-p-urgent" title="Move note to .trash" onclick={() => ondelete(note.file)}>Delete</button>
	{/if}
</div>
{#if preview}
	<div class="prose-md flex-1 overflow-y-auto px-8 py-6">{@html html}</div>
{:else}
	<div class="min-h-0 flex-1"><Editor value={note.body} onchange={(v) => note.edit(v)} onfiles={uploadFiles} /></div>
{/if}
