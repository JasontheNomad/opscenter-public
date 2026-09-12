<script lang="ts">
	import { initials, hue } from '$lib/format';
	// Teams user avatar: photo via proxy, falls back to colored initials
	let { id, name, size = 32 }: { id: string | null; name: string; size?: number } = $props();
	let failedFor = $state<string | null>(null);
	const failed = $derived(failedFor === id);
</script>

{#if id && !failed}
	<img src="/api/teams/photo/{id}" alt="" class="shrink-0 rounded-full object-cover" style="width:{size}px;height:{size}px" onerror={() => (failedFor = id)} />
{:else}
	<div class="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.34)}px;background: hsl({hue(name)} 45% 45%)">{initials(name || '?')}</div>
{/if}
