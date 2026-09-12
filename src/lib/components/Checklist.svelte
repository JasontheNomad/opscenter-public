<script lang="ts">
	// A card's checklist. Local only, never sent to HubSpot; saved as the task's JSON `checklist`.
	import { parseChecklist, type ChecklistItem } from '$lib/types';

	let { checklist, onsave }: { checklist: string; onsave: (list: ChecklistItem[]) => void } = $props();

	const items = $derived(parseChecklist(checklist));
	const doneCount = $derived(items.filter((i) => i.done).length);
	let newItem = $state('');
	function addItem() {
		const text = newItem.trim();
		if (!text) return;
		newItem = '';
		onsave([...items, { id: crypto.randomUUID(), text, done: false }]);
	}
	const toggle = (id: string) => onsave(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
	const removeItem = (id: string) => onsave(items.filter((i) => i.id !== id));
	const editItem = (id: string, text: string) =>
		text.trim() ? onsave(items.map((i) => (i.id === id ? { ...i, text: text.trim() } : i))) : removeItem(id);
</script>

<div>
	<div class="mb-2 flex items-center gap-2 border-b border-border pb-1.5 text-sm font-semibold text-text">
		Checklist
		{#if items.length}<span class="text-xs font-normal text-muted">{doneCount}/{items.length}</span>{/if}
	</div>
	<ul class="flex flex-col gap-1">
		{#each items as item (item.id)}
			<li class="group flex items-center gap-2">
				<input type="checkbox" checked={item.done} onchange={() => toggle(item.id)} class="size-3.5 accent-[var(--color-accent)]" />
				<input
					class="min-w-0 flex-1 bg-transparent text-xs {item.done ? 'text-muted line-through' : 'text-text'} focus:outline-none"
					value={item.text}
					onchange={(e) => editItem(item.id, e.currentTarget.value)}
				/>
				<button class="text-muted opacity-0 group-hover:opacity-100 hover:text-p-urgent" onclick={() => removeItem(item.id)} aria-label="Remove">×</button>
			</li>
		{/each}
	</ul>
	<form onsubmit={(e) => (e.preventDefault(), addItem())} class="mt-1 flex items-center gap-2">
		<span class="size-3.5 rounded-sm border border-border"></span>
		<input bind:value={newItem} placeholder="Add item… ↵" class="min-w-0 flex-1 bg-transparent text-xs placeholder:text-muted focus:outline-none" />
	</form>
</div>
