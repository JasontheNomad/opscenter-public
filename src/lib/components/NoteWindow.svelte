<!--
  What a note's own window shows (see lib/notes/window.svelte.ts). The text is fetched here rather
  than before the window opens: a popup must be opened inside the click that asked for it, so nothing
  may be awaited first.
-->
<script lang="ts">
	import { api, errMsg } from '$lib/api';
	import { NoteSession } from '$lib/noteSession.svelte';
	import NotePane from './NotePane.svelte';

	let { client, file, onclose }: { client: string; file: string; onclose: () => void } = $props();

	let note = $state<NoteSession | null>(null);
	let error = $state('');

	$effect(() => {
		let gone = false;
		void (async () => {
			try {
				const n = await api<{ body: string; mtime: string | null }>(`/api/notes?client=${encodeURIComponent(client)}&file=${encodeURIComponent(file)}`);
				if (!gone) note = new NoteSession(client, file, n.body, n.mtime);
			} catch (e) {
				if (!gone) error = errMsg(e);
			}
		})();
		return () => { gone = true; };
	});

	// the window is going away: whatever is still typed must reach the file first
	$effect(() => {
		const save = () => void note?.save({ keepalive: true });
		addEventListener('pagehide', save);
		return () => removeEventListener('pagehide', save);
	});
</script>

<div class="flex h-screen flex-col bg-bg text-text">
	{#if note}
		<NotePane {note} {client} />
	{:else if error}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
			<p class="err max-w-md text-center">{error}</p>
			<button class="btn px-3 py-1 text-xs" onclick={onclose}>Close</button>
		</div>
	{:else}
		<p class="flex flex-1 items-center justify-center text-sm text-muted">Opening…</p>
	{/if}
</div>
