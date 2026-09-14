<!--
  Floating Text size panel (Settings → Pop out). Stays open across pages so each area can be sized
  while looking at it. Its own text is deliberately unscaled.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { textPanel } from '$lib/textPanel.svelte';
	import { TEXT_AREAS, TEXT_SIZES, DEFAULT_SIZE, type TextArea } from '$lib/textSize';
	import Icon from './Icon.svelte';

	const sizeOf = (a: TextArea) => page.data.textSize?.[a] ?? DEFAULT_SIZE;
	async function step(a: TextArea, dir: 1 | -1) {
		const i = TEXT_SIZES.indexOf(sizeOf(a));
		const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, (i < 0 ? TEXT_SIZES.indexOf(DEFAULT_SIZE) : i) + dir))];
		await api('/api/settings/text-size', 'PATCH', { area: a, size: next });
		await invalidateAll();
	}
	async function resetAll() {
		await api('/api/settings/text-size', 'DELETE');
		await invalidateAll();
	}

	// drag by the header; position kept for the session
	let x = $state(0);
	let y = $state(0);
	function drag(e: PointerEvent) {
		if (e.button !== 0) return;
		const sx = e.clientX - x, sy = e.clientY - y;
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (m: PointerEvent) => { x = m.clientX - sx; y = m.clientY - sy; };
		const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}
</script>

{#if textPanel.open}
	<div
		data-overlay
		class="fixed right-4 bottom-4 z-[60] w-80 rounded-lg border border-border bg-surface shadow-2xl"
		style="transform: translate({x}px, {y}px); --text-scale: 1; font-size: 13px;"
	>
		<header class="flex cursor-grab items-center gap-2 border-b border-border px-3 py-2 select-none active:cursor-grabbing" role="toolbar" aria-label="Text size — drag to move" tabindex="-1" onpointerdown={drag}>
			<span class="flex-1 text-sm font-medium text-text">Text size</span>
			<button class="link-muted text-xs" onpointerdown={(e) => e.stopPropagation()} onclick={resetAll}>Reset all</button>
			<button class="link-muted" onpointerdown={(e) => e.stopPropagation()} onclick={() => (textPanel.open = false)} aria-label="Close"><Icon name="x" class="size-4" /></button>
		</header>
		<ul class="max-h-[70vh] overflow-y-auto py-1">
			{#each TEXT_AREAS as a (a.id)}
				<li class="flex items-center gap-2 px-3 py-1">
					<span class="min-w-0 flex-1 truncate text-xs text-text" title={a.hint}>{a.name}</span>
					<button class="btn size-6 p-0 text-sm text-muted hover:text-text" onclick={() => step(a.id, -1)} aria-label="Smaller {a.name}" disabled={sizeOf(a.id) <= TEXT_SIZES[0]}>−</button>
					<span class="w-8 text-center text-xs tabular-nums {sizeOf(a.id) === DEFAULT_SIZE ? 'text-muted' : 'text-accent'}">{sizeOf(a.id)}</span>
					<button class="btn size-6 p-0 text-sm text-muted hover:text-text" onclick={() => step(a.id, 1)} aria-label="Bigger {a.name}" disabled={sizeOf(a.id) >= TEXT_SIZES[TEXT_SIZES.length - 1]}>+</button>
				</li>
			{/each}
		</ul>
		<p class="border-t border-border px-3 py-1.5 text-2xs text-muted">Drag the header. Stays open while you move around the app.</p>
	</div>
{/if}
