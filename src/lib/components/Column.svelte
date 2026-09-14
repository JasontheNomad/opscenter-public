<script lang="ts">
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import Card from './Card.svelte';
	import type { Task } from '$lib/types';

	let {
		name,
		items,
		selectedId,
		dragDisabled = false,
		onconsider,
		onfinalize,
		onselect
	}: {
		name: string;
		items: Task[];
		selectedId: number | null;
		dragDisabled?: boolean;
		onconsider: (items: Task[]) => void;
		onfinalize: (items: Task[]) => void;
		onselect: (id: number) => void;
	} = $props();
</script>

<div class="flex w-72 shrink-0 flex-col">
	<header class="mb-2 flex items-center gap-2 px-1">
		<h2 class="text-xs font-medium text-text">{name}</h2>
		<span class="text-xs text-muted">{items.length}</span>
	</header>
	<section
		class="flex min-h-24 flex-1 flex-col gap-1.5 rounded-lg bg-surface p-1.5"
		use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {}, dragDisabled }}
		onconsider={(e: CustomEvent<DndEvent<Task>>) => onconsider(e.detail.items)}
		onfinalize={(e: CustomEvent<DndEvent<Task>>) => onfinalize(e.detail.items)}
	>
		{#each items as task (task.id)}
			<Card {task} selected={task.id === selectedId} {onselect} />
		{/each}
	</section>
</div>
