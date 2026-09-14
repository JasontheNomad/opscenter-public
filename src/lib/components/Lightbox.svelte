<script lang="ts">
	// Fullscreen image viewer. Any <img data-zoom> inside the page opens here.
	import { lightbox, openLightbox, closeLightbox } from '$lib/lightbox.svelte';
	function onclick(e: MouseEvent) {
		const t = e.target as HTMLElement;
		if (t.tagName === 'IMG' && t.hasAttribute('data-zoom')) {
			e.preventDefault();
			e.stopPropagation();
			openLightbox((t as HTMLImageElement).src, (t as HTMLImageElement).alt);
		}
	}
	function onkey(e: KeyboardEvent) {
		if (lightbox.src && e.key === 'Escape') (e.stopPropagation(), closeLightbox());
	}
</script>

<svelte:window onclickcapture={onclick} onkeydowncapture={onkey} />

{#if lightbox.src}
	<div data-overlay class="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6" role="presentation" onclick={closeLightbox}>
		<img src={lightbox.src} alt={lightbox.alt} class="max-h-full max-w-full rounded-md shadow-2xl" />
		<button class="absolute top-4 right-4 rounded-md bg-surface/80 px-3 py-1.5 text-sm text-text hover:bg-surface" onclick={closeLightbox}>✕ Close</button>
		<a href={lightbox.src} download class="absolute bottom-4 right-4 rounded-md bg-surface/80 px-3 py-1.5 text-xs link-muted" onclick={(e) => e.stopPropagation()}>Download</a>
	</div>
{/if}
