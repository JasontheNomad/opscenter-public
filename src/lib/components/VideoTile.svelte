<!--
  One participant. Renders the SDK's renderer view when there's video, an avatar when there isn't.
  The view is an HTMLElement owned by the SDK, so it is *moved* into place and removed on teardown —
  never innerHTML'd, and never disposed here: the engine owns its lifetime.
-->
<script lang="ts">
	import Avatar from '$lib/components/Avatar.svelte';
	import type { Tile } from '$lib/calls/media';

	let { tile, compact = false, fill = false }: { tile: Tile; compact?: boolean; fill?: boolean } = $props();
	let host = $state<HTMLDivElement | null>(null);

	// keyed on the element, not the tile: tiles are replaced whenever anyone speaks or mutes, and depending
	// on the object detached and re-attached every video each time
	const target = $derived(tile.view?.target ?? null);
	$effect(() => {
		const el = host;
		if (!el || !target) return;
		el.replaceChildren(target);
		// only detach; disposing belongs to whoever created the renderer
		return () => el.replaceChildren();
	});
</script>

<div
	class="relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-2 ring-2 transition-colors {tile.speaking ? 'ring-accent' : 'ring-transparent'}"
	class:aspect-video={!compact && !fill}
	class:size-full={fill}
>
	{#if tile.view}
		<div bind:this={host} class="size-full [&>*]:size-full"></div>
	{:else}
		<Avatar id={null} name={tile.name} size={compact ? 40 : 72} />
	{/if}

	<div class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
		{#if tile.hand}<span title="Hand raised">✋</span>{/if}
		<span class="min-w-0 flex-1 truncate text-2xs text-white">{tile.name}</span>
		{#if tile.muted}<span class="text-2xs text-white/70" title="Muted">muted</span>{/if}
	</div>
</div>
