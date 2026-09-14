<script lang="ts">
	import { api, errMsg } from '$lib/api';
	import { openLightbox } from '$lib/lightbox.svelte';
	import { relativeDay as when } from '$lib/format';
	import Icon from './Icon.svelte';
	// "Shared" tab: files, images and links found in the conversation history
	type Item = { kind: 'file' | 'image' | 'link'; name: string; url: string; host?: string; at: string; by: string };
	let { target }: { target: { chat: string } | { team: string; channel: string } } = $props();

	let items = $state<Item[]>([]);
	let loading = $state(true);
	let err = $state('');
	let filter = $state<'recent' | 'files' | 'links'>('recent');
	let q = $state('');

	// string key: the target prop is a fresh object literal on every parent refresh
	const qs = $derived('chat' in target ? `chat=${encodeURIComponent(target.chat)}` : `team=${encodeURIComponent(target.team)}&channel=${encodeURIComponent(target.channel)}`);
	$effect(() => {
		qs;
		loading = true; err = '';
		api<typeof items>(`/api/teams/shared?${qs}`).then((d) => (items = d)).catch((e) => (err = errMsg(e))).finally(() => (loading = false));
	});
	const shown = $derived(items.filter((i) => (filter === 'recent' || (filter === 'files' ? i.kind !== 'link' : i.kind === 'link')) && (!q || i.name.toLowerCase().includes(q.toLowerCase()) || (i.host ?? '').includes(q.toLowerCase()))));
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
		{#each ([['recent', 'clock', 'Recent'], ['files', 'file', 'Files'], ['links', 'globe', 'Links']] as const) as [id, icon, label] (id)}
			<button class="rounded-full border px-3 py-1 text-xs {filter === id ? 'border-accent bg-accent/15 text-text' : 'border-border link-muted'}" onclick={() => (filter = id)}><Icon name={icon} class="mr-1.5 inline size-3.5" />{label}</button>
		{/each}
		<span class="flex-1"></span>
		<input bind:value={q} placeholder="Filter by keyword" class="w-52 rounded-md border border-border bg-surface px-2 py-1 text-xs placeholder:text-muted focus-accent" />
	</div>
	<div class="flex-1 overflow-y-auto">
		{#if loading}<p class="p-4 text-xs text-muted">Scanning conversation…</p>
		{:else if err}<p class="p-4 text-xs text-p-urgent">{err}</p>
		{:else}
			<table class="w-full text-body">
				<thead class="sticky top-0 bg-bg text-left text-caption text-muted"><tr><th class="px-4 py-2 font-medium">Name</th><th class="w-36 px-2 py-2 font-medium">Date shared</th><th class="w-44 px-2 py-2 font-medium">Shared by</th></tr></thead>
				<tbody>
					{#each shown as i (i.url)}
						<tr class="border-t border-border hover:bg-surface-2/50">
							<td class="px-4 py-2">
								<div class="flex items-center gap-3">
									{#if i.kind === 'image'}<img src={i.url} alt="" class="size-8 rounded object-cover" loading="lazy" data-zoom />
									{:else if i.kind === 'file'}<span class="flex size-8 items-center justify-center rounded bg-surface-2 text-muted"><Icon name="file" class="size-4" /></span>
									{:else}<span class="flex size-8 items-center justify-center rounded bg-surface-2 text-muted"><Icon name="globe" class="size-4" /></span>{/if}
									<div class="min-w-0">
										{#if i.kind === 'link'}
											<a href={i.url} target="_blank" rel="noreferrer" class="block truncate text-text hover:underline">{i.name}</a>
											<div class="truncate text-caption text-muted">{i.host}</div>
										{:else if i.kind === 'image'}
											<button class="block truncate text-left text-text hover:underline" onclick={() => openLightbox(i.url, i.name)}>{i.name}</button>
										{:else}
											<a href={i.url} target="_blank" rel="noreferrer" class="block truncate text-text hover:underline">{i.name}</a>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-2 py-2 text-muted">{when(i.at)}</td>
							<td class="px-2 py-2 text-muted">{i.by}</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="px-4 py-6 text-center text-xs text-muted">Nothing shared yet.</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
