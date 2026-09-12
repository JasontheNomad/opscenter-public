<script lang="ts">
	// Pending attachments above a composer: thumbnails / file cards with a hover ×.
	import Icon from './Icon.svelte';
	import { kb, isImage, type Att } from '$lib/attachments';
	let { atts, onremove }: { atts: Att[]; onremove: (i: number) => void } = $props();
</script>

{#if atts.length}
	<div class="flex flex-wrap gap-2">
		{#each atts as a, i (a.id)}
			<div class="group relative">
				{#if isImage(a)}
					<img src={a.url} alt={a.name} class="h-20 rounded-md border border-border object-cover" />
				{:else}
					<div class="flex h-20 w-40 flex-col justify-center rounded-md border border-border bg-surface-2 px-2 text-caption">
						<span class="flex items-center gap-1 truncate text-text"><Icon name="paperclip" class="size-3" />{a.name}</span>
						<span class="text-muted">{kb(a.size)}</span>
					</div>
				{/if}
				<button type="button" class="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-surface text-xs text-text ring-1 ring-border group-hover:flex" onclick={() => onremove(i)} aria-label="Remove">×</button>
			</div>
		{/each}
	</div>
{/if}
