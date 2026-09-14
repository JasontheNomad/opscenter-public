<!--
  Roster panel for the call window (Phase 5): who's on the call, and a search to pull someone else in.
  People search is the existing /api/teams/people endpoint — no new server surface.
-->
<script lang="ts">
	import { errMsg } from '$lib/api';
	import { calls } from '$lib/calls/engine.svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	type Person = { id: string; name: string; mail?: string };

	let q = $state('');
	let results = $state<Person[]>([]);
	let busy = $state(false);
	let adding = $state<string | null>(null);
	let err = $state('');

	// people already on the call, so we don't offer to add them again
	const present = $derived(new Set(calls.tiles.map((t) => t.id).filter(Boolean) as string[]));

	$effect(() => {
		const term = q.trim();
		if (term.length < 2) { results = []; return; }
		// debounce: the search hits Graph, and every keystroke would be a request
		const id = setTimeout(async () => {
			busy = true;
			try {
				const r = await fetch(`/api/teams/people?q=${encodeURIComponent(term)}`);
				results = r.ok ? await r.json() : [];
			} catch {
				results = [];
			}
			busy = false;
		}, 250);
		return () => clearTimeout(id);
	});

	async function add(p: Person) {
		adding = p.id;
		err = '';
		try {
			calls.addParticipant(p.id); // synchronous: the SDK dials and reports through events
			q = '';
			results = [];
		} catch (e) {
			err = errMsg(e);
		}
		adding = null;
	}
</script>

<div class="flex w-60 shrink-0 flex-col border-l border-border">
	<div class="border-b border-border px-3 py-2 text-caption text-muted">
		In this call · {calls.tiles.length + 1}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-1">
		{#each calls.tiles as t (t.key)}
			<div class="flex items-center gap-2 rounded-md px-1.5 py-1.5">
				<Avatar id={t.id} name={t.name} size={24} />
				<span class="min-w-0 flex-1 truncate text-xs text-text">{t.name || 'Unknown'}</span>
				{#if t.hand}<span class="text-2xs" title="Hand raised">✋</span>{/if}
				{#if t.muted}<span class="text-2xs text-muted">muted</span>{/if}
			</div>
		{:else}
			<p class="px-1.5 py-2 text-caption text-muted">Nobody else yet.</p>
		{/each}
	</div>

	<div class="border-t border-border p-2">
		<input
			class="w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs"
			placeholder="Add someone…"
			bind:value={q}
		/>
		{#if err}<p class="err mt-1 text-2xs">{err}</p>{/if}
		{#if busy && !results.length}<p class="mt-1 px-1 text-2xs text-muted">Searching…</p>{/if}
		{#each results as p (p.id)}
			<button
				class="mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2 disabled:opacity-50"
				disabled={present.has(p.id) || adding === p.id}
				onclick={() => add(p)}
			>
				<Avatar id={p.id} name={p.name} size={22} />
				<span class="min-w-0 flex-1 truncate text-xs text-text">{p.name}</span>
				<span class="text-2xs text-muted">{present.has(p.id) ? 'in call' : adding === p.id ? '…' : 'Add'}</span>
			</button>
		{/each}
	</div>
</div>
