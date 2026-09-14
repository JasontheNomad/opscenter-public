<!--
  One open note: the header (save state, optional delete) and the editor. The editor renders as it
  goes (lib/mdMarks.ts), so there is no separate preview. Shared by the Clients page and a note's own
  window (lib/notes/window.svelte.ts), so both behave identically — same autosave, same attachment upload.
-->
<script lang="ts">
	import Editor from './Editor.svelte';
	import { api, post } from '$lib/api';
	import { readFiles, mdLink, tooBig } from '$lib/attachments';
	import type { NoteSession } from '$lib/noteSession.svelte';

	let { note, client, line, ondelete, onopen }: {
		note: NoteSession;
		client: string;
		/** line to show first (a search hit); changes while the note stays open move to the new line */
		line?: number;
		ondelete?: (file: string) => void;
		/** a `[[wiki-link]]` was clicked: open that note here */
		onopen?: (client: string, file: string) => void;
	} = $props();

	const enc = encodeURIComponent;

	// relative image/link paths in the vault (attachments/x.png) -> served by the app
	const fileUrl = (rel: string) => `/api/notes/file?client=${enc(client)}&path=${enc(rel)}`;
	// as written in the note: `attachments/Pasted%20image.png` (encoded by uploadFiles), or an absolute url left alone
	const ABSOLUTE = /^(https?:|mailto:|data:|\/)/;
	function srcUrl(src: string): string {
		if (ABSOLUTE.test(src)) return src;
		let p = src;
		try { p = decodeURIComponent(src); } catch { /* a path that isn't encoded */ }
		return fileUrl(p);
	}
	// a `[text](url)` clicked in the editor: the web in a new tab, a file in the vault through the app
	const openHref = (url: string) => window.open(/^www\./.test(url) ? `https://${url}` : srcUrl(url), '_blank', 'noopener');
	// Obsidian wiki-links `[[Note]]` / `[[Note|label]]` / `[[Note#heading]]` -> the note they name. The server says
	// which note that is (own folder first, then any); a name it doesn't know opens nothing. Resolved as the text
	// changes, not on click: a click must open a note window at once, and a popup opened after an await is blocked.
	const WIKI = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
	type Ref = { client: string; file: string };
	let refs = $state<Record<string, Ref | null>>({});
	// one fetch per distinct set of names, not per keystroke
	const wikiNames = $derived([...new Set([...note.body.matchAll(WIKI)].map((m) => m[1].trim()))].sort().join('\n'));
	$effect(() => {
		const names = wikiNames.split('\n').filter(Boolean);
		if (!names.length) return void (refs = {});
		let stale = false;
		void api<typeof refs>(`/api/notes/resolve?client=${enc(client)}&${names.map((n) => `n=${enc(n)}`).join('&')}`)
			.then((r) => { if (!stale) refs = r; })
			.catch(() => {}); // unresolved links open nothing until the names change again
		return () => { stale = true; };
	});
	function openWiki(name: string) {
		const r = refs[name];
		if (r) onopen?.(r.client, r.file);
	}
	// `[[` in the editor offers this client's other notes; fetched on first use, once per pane
	let titles: Promise<string[]> | undefined;
	const linkTitles = () =>
		(titles ??= api<{ notes: { file: string; title: string }[] }>(`/api/notes?client=${enc(client)}`)
			.then((r) => r.notes.filter((n) => n.file !== note.file).map((n) => n.title))
			.catch(() => ((titles = undefined), [])));

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
		// encodeURI: a bare destination with spaces (macOS screenshot names) isn't a markdown link; Obsidian reads both
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
	{#if ondelete}
		<button class="hover:text-p-urgent" title="Move note to .trash" onclick={() => ondelete(note.file)}>Delete</button>
	{/if}
</div>
<div class="min-h-0 flex-1"><Editor value={note.body} {line} onchange={(v) => note.edit(v)} onfiles={uploadFiles} onlink={linkTitles} onwiki={openWiki} onhref={openHref} imageUrl={srcUrl} /></div>
