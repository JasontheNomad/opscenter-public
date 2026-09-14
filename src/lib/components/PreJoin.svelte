<!--
  Pre-join (Phase 5), laid out like Teams' "Meeting join" window: big camera preview on the left,
  audio devices on the right, Join now at the bottom. Shown before an outbound call or a meeting
  join, so nobody discovers a dead mic or the wrong camera once they're live. Fills whatever holds
  it — the call window, or the whole app when the popup was blocked.
  The preview is the engine's own local stream, which the call then reuses.
-->
<script lang="ts">
	import { calls } from '$lib/calls/engine.svelte';
	import { MicMeter } from '$lib/calls/media';
	import { untrack } from 'svelte';

	let { title, sub = '', startVideo = false, onjoin, oncancel }: { title: string; sub?: string; startVideo?: boolean; onjoin: (opts: { video: boolean }) => void; oncancel: () => void } = $props();

	// 'Video call' from the menu arrives with the camera already ticked; audio calls don't.
	// Initial value only — the screen is mounted fresh per call, and the toggle owns it after that.
	let video = $state(untrack(() => startVideo));
	let level = $state(0);
	let box = $state<HTMLDivElement | null>(null);
	const meter = new MicMeter();

	$effect(() => {
		untrack(() => void calls.start());
	});

	// one meter, restarted only when the chosen mic changes, so the bar reflects what will actually be used
	$effect(() => {
		const id = calls.selected.mic;
		untrack(() => void meter.start(id, (v) => (level = v)));
		return () => void meter.stop();
	});

	// depends on the toggle only — startVideo reads the camera list and choices, which must not
	// restart the camera (a camera change is handled by selectCamera itself)
	$effect(() => {
		const on = video;
		untrack(() => void (on ? calls.startVideo() : calls.stopVideo()));
	});

	// videoOn flips once the preview view exists; previewView itself isn't reactive
	$effect(() => {
		const el = box;
		const target = video && calls.videoOn ? calls.previewView?.target : null;
		if (!el || !target) return;
		el.replaceChildren(target);
		return () => el.replaceChildren();
	});

	const micOk = $derived(calls.mic !== 'denied' && calls.mics.length > 0);
	const select = 'min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1.5 text-sm focus-accent';
</script>

<div class="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-bg px-6 py-10">
	<h1 class="text-center text-xl font-semibold text-text">{title}</h1>
	{#if sub}<p class="mt-1 text-center text-sm text-muted">{sub}</p>{/if}

	<div class="mt-8 grid w-full max-w-5xl gap-4 md:grid-cols-[3fr_2fr]">
		<!-- camera -->
		<section class="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
			<div class="flex aspect-video items-center justify-center bg-black [&>*]:size-full">
				{#if video}
					<div bind:this={box} class="size-full"></div>
				{:else}
					<span class="flex items-center justify-center text-sm text-muted">Your camera is off</span>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2 text-sm">
				<button
					role="switch"
					aria-checked={video}
					aria-label="Camera"
					class="relative h-5 w-9 shrink-0 rounded-full transition-colors {video ? 'bg-accent' : 'bg-border-2'}"
					onclick={() => (video = !video)}
				><span class="absolute top-0.5 size-4 rounded-full bg-white transition-[left] {video ? 'left-[1.1rem]' : 'left-0.5'}"></span></button>
				<select class={select} value={calls.selected.camera ?? ''} onchange={(e) => calls.selectCamera(e.currentTarget.value)} aria-label="Camera">
					{#each calls.cameras as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
				</select>
				<label class="flex items-center gap-2 text-muted"><input type="checkbox" checked={calls.blur} onchange={(e) => calls.setBlur(e.currentTarget.checked)} />Blur background</label>
			</div>
		</section>

		<!-- audio -->
		<section class="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-sm">
			<div class="grid gap-2">
				<span class="field-label">Microphone</span>
				<select class={select} value={calls.selected.mic ?? ''} onchange={(e) => calls.selectMic(e.currentTarget.value)}>
					{#each calls.mics as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
				</select>
				<!-- live level, so "is my mic working" is answered before the call, not during it -->
				<div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
					<div class="h-full bg-avail transition-[width] duration-75" style="width:{Math.round(level * 100)}%"></div>
				</div>
				{#if !micOk}<p class="err">No microphone available — check permissions.</p>{/if}
			</div>
			<div class="grid gap-2">
				<span class="field-label">Speaker</span>
				<select class={select} value={calls.selected.speaker ?? ''} onchange={(e) => calls.selectSpeaker(e.currentTarget.value)}>
					{#each calls.speakers as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</select>
			</div>
		</section>
	</div>

	{#if calls.error}<p class="err mt-4 w-full max-w-5xl">{calls.error}</p>{/if}

	<div class="mt-6 flex w-full max-w-5xl justify-end gap-2">
		<button class="btn px-4 py-1.5 text-sm" onclick={oncancel}>Cancel</button>
		<button class="btn-primary px-5 py-1.5 text-sm" disabled={!micOk} onclick={() => onjoin({ video })}>Join now</button>
	</div>
</div>
