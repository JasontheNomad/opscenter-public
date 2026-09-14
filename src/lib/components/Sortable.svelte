<script lang="ts" generics="T extends { id: string }">
	// Drag-to-reorder list (svelte-dnd-action). Parent owns `items` (bindable) and persists the order in onreorder.
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { Snippet } from 'svelte';
	let { items = $bindable(), disabled = false, onreorder, row, class: cls = '' }: { items: T[]; disabled?: boolean; onreorder: (ids: string[]) => void; row: Snippet<[T]>; class?: string } = $props();
	const set = (e: CustomEvent<DndEvent<T>>) => (items = e.detail.items);
</script>

<div class={cls} use:dndzone={{ items, flipDurationMs: 120, dropTargetStyle: {}, dragDisabled: disabled }} onconsider={set} onfinalize={(e) => { set(e); onreorder(items.map((i) => i.id)); }}>
	{#each items as it (it.id)}<div>{@render row(it)}</div>{/each}
</div>
