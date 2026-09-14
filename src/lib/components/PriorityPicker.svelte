<script lang="ts">
	import { PRIORITY } from '$lib/priority';
	let { value, disabled = false, onchange }: { value: number; disabled?: boolean; onchange: (p: number) => void } = $props();
</script>

<div class="flex gap-1">
	{#each PRIORITY as p, i (i)}
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs {value === i ? 'border-border-2 bg-surface-2 text-text' : 'border-transparent text-muted hover:border-border'} disabled:cursor-default disabled:hover:border-transparent"
			{disabled}
			onclick={() => onchange(i)}
		>
			<span class="size-1.5 rounded-full {p.dot}"></span>{p.label}
		</button>
	{/each}
</div>
