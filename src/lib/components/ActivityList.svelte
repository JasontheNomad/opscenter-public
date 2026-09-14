<script lang="ts">
	import { shortDateTime as when } from '$lib/format';
	type Item = { id: string; kind: string; at: string; by: string; preview: string; where: string; href: string; seen: boolean };
	let { title, items, empty }: { title: string; items: Item[]; empty: string } = $props();
</script>

<section class="flex min-w-0 flex-1 flex-col">
	<header class="pane-header gap-3 px-4"><span class="text-sm font-semibold">{title}</span><span class="text-caption text-muted">{items.length}</span></header>
	<div class="flex-1 overflow-y-auto p-4">
		<div class="mx-auto flex max-w-3xl flex-col gap-2">
			{#each items as a (a.id)}
				<a href={a.href} class="block rounded-md border bg-surface-2 px-3 py-2 hover:border-accent {a.seen ? 'border-border' : 'border-accent/60'}">
					<div class="mb-0.5 flex items-center gap-2 text-caption text-muted"><span class="font-medium text-text">{a.by}</span><span>·</span><span class="truncate">{a.where}</span><span class="flex-1"></span><span>{when(a.at)}</span></div>
					<div class="line-clamp-2 text-body text-text">{a.preview}</div>
				</a>
			{:else}
				<p class="text-xs text-muted">{empty}</p>
			{/each}
		</div>
	</div>
</section>
