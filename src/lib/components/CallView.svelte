<!--
  The in-call surface (Phase 5, docs/acs-calling-sow.md), laid out like the Teams meeting window:
  toolbar across the top, the stage below.
    alone        — your own camera fills the stage (or your avatar, camera off)
    one other    — they fill the stage, you're a small draggable self-view
    more         — gallery grid of everyone else, plus the self-view
  Normally it fills the call's own window (`popout`, see $lib/calls/window.svelte.ts). When the
  browser blocked that popup it shows in-app: docked (full pane, the default) or compact.
-->
<script lang="ts">
	import { calls } from '$lib/calls/engine.svelte';
	import { pipDrag } from '$lib/calls/pip';
	import VideoTile from '$lib/components/VideoTile.svelte';
	import CallRoster from '$lib/components/CallRoster.svelte';
	import CallChat from '$lib/components/CallChat.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { popout = false }: { popout?: boolean } = $props();
	let layout = $state<'compact' | 'docked'>('docked');
	let showPeople = $state(false);
	let showChat = $state(false);
	let menu = $state<'camera' | 'mic' | 'more' | null>(null);
	let self = $state<HTMLDivElement | null>(null);
	const compact = $derived(!popout && layout === 'compact');

	// duration only means something once media is up
	// keeps its own previous value while the call stays up — not expressible as a $derived
	// eslint-disable-next-line svelte/prefer-writable-derived
	let since = $state<number | null>(null);
	let now = $state(Date.now());
	$effect(() => {
		since = calls.callState === 'Connected' ? (since ?? Date.now()) : calls.inCall ? since : null;
	});
	$effect(() => {
		if (!calls.inCall) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	const clock = $derived.by(() => {
		if (!since) return '00:00';
		const s = Math.max(0, Math.floor((now - since) / 1000));
		const h = Math.floor(s / 3600);
		const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
		return `${h ? `${h}:` : ''}${m}:${String(s % 60).padStart(2, '0')}`;
	});

	// local preview lives in the engine; move its element into whichever self box is showing
	// (the whole stage when alone, the small draggable one otherwise)
	$effect(() => {
		const el = self;
		const target = calls.videoOn ? calls.previewView?.target : null;
		if (!el || !target) return;
		el.replaceChildren(target);
		return () => el.replaceChildren();
	});

	const alone = $derived(calls.tiles.length === 0);
	const cols = $derived(calls.tiles.length <= 1 ? 1 : calls.tiles.length <= 4 ? 2 : 3);
	const waiting = $derived(
		calls.callState === 'InLobby' ? 'Waiting to be admitted'
			: calls.callState === 'Connecting' || calls.callState === 'None' ? 'Connecting…'
			: calls.callState === 'Ringing' ? 'Ringing…'
			: 'Waiting for others to join'
	);
	const title = $derived(calls.tiles.map((t) => t.name).filter(Boolean).join(', '));
	const toggle = (m: 'camera' | 'mic' | 'more') => (menu = menu === m ? null : m);
	const select = 'w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs';
</script>

{#snippet tool(icon: string, label: string, onclick: () => void, active = false, off = false)}
	<button
		class="group flex h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-lg px-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
			{active ? 'bg-accent/15 text-accent' : off ? 'text-p-urgent hover:bg-surface-2' : 'text-muted hover:bg-surface-2 hover:text-text'}"
		{onclick}
		title={label}
	>
		<Icon name={icon} class="size-[18px]" />
		{#if !compact}<span class="text-2xs leading-none {active || off ? '' : 'text-muted group-hover:text-text'}">{label}</span>{/if}
	</button>
{/snippet}

<!-- Camera / Mic: the button plus a slim caret for the device picker, drawn as one control -->
{#snippet split(icon: string, label: string, onclick: () => void, m: 'camera' | 'mic', off = false, busy = false)}
	<div class="flex h-11 items-stretch overflow-hidden rounded-lg border border-border bg-surface-2/60">
		<button
			class="flex min-w-14 flex-col items-center justify-center gap-0.5 px-2.5 transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 {off ? 'text-p-urgent' : 'text-text'}"
			{onclick}
			disabled={busy}
			title={label}
		>
			<Icon name={icon} class="size-[18px]" />
			{#if !compact}<span class="text-2xs leading-none {off ? '' : 'text-muted'}">{label}</span>{/if}
		</button>
		<button
			class="flex w-6 items-center justify-center border-l border-border text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent {menu === m ? 'bg-surface-2 text-text' : ''}"
			onclick={() => toggle(m)}
			aria-label="{label} options"
		><Icon name="chevron-down" class="size-3" /></button>
	</div>
{/snippet}

{#if calls.inCall}
	<section
		class="fixed z-50 flex flex-col overflow-hidden bg-bg
			{popout ? 'inset-0' : `rounded-xl border border-border shadow-2xl ${layout === 'compact' ? 'bottom-4 right-4 w-[30rem]' : 'inset-4'}`}"
	>
		<header class="relative flex h-14 items-center gap-1.5 border-b border-border bg-surface pr-3 pl-4">
			<div class="flex min-w-0 flex-1 items-center gap-2.5">
				<span class="size-2 shrink-0 rounded-full {calls.callState === 'Connected' ? 'bg-avail' : 'bg-p-med'}"></span>
				<span class="text-body tabular-nums text-text">{clock}</span>
				{#if calls.quality}<span class="text-caption text-p-high">{calls.quality}</span>{:else if calls.warning}<span class="text-caption text-p-med">{calls.warning}</span>{/if}
				{#if !popout && title}<span class="min-w-0 truncate text-caption text-muted">{title}</span>{/if}
			</div>

			{@render tool('message', 'Chat', () => { showChat = !showChat; if (showChat) layout = 'docked'; }, showChat)}
			{@render tool('users', 'People', () => { showPeople = !showPeople; if (showPeople) layout = 'docked'; }, showPeople)}
			{@render tool('hand', calls.handRaised ? 'Lower' : 'Raise', () => void calls.raiseHand(), calls.handRaised)}
			{@render tool('dots', 'More', () => toggle('more'), menu === 'more')}
			<span class="mx-2 h-6 w-px bg-border"></span>
			{@render split(calls.videoOn ? 'video' : 'video-off', 'Camera', () => void (calls.videoOn ? calls.stopVideo() : calls.startVideo()), 'camera', !calls.videoOn, calls.cameraBusy)}
			{@render split(calls.muted ? 'mic-off' : 'mic', 'Mic', () => void (calls.muted ? calls.unmute() : calls.mute()), 'mic', calls.muted)}
			{@render tool('share', calls.sharing ? 'Stop' : 'Share', () => void (calls.sharing ? calls.stopScreenShare() : calls.startScreenShare()), calls.sharing)}
			<span class="mx-2 h-6 w-px bg-border"></span>
			<button
				class="flex h-9 items-center gap-2 rounded-lg bg-alert px-3.5 text-body font-medium text-white transition-colors hover:bg-alert-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				onclick={() => calls.hangUp()}
				title="Leave"
			><Icon name="phone-off" class="size-[18px]" />{#if !compact}<span>Leave</span>{/if}</button>

			{#if menu}
				<button class="fixed inset-0 z-10 cursor-default" onclick={() => (menu = null)} aria-label="Close menu"></button>
				<div class="absolute top-full right-3 z-20 mt-1.5 grid w-72 gap-2.5 rounded-lg border border-border bg-surface p-3 text-xs shadow-xl">
					{#if menu === 'camera'}
						<label class="grid gap-1"><span class="field-label">Camera</span>
							<select class={select} value={calls.selected.camera ?? ''} onchange={(e) => calls.selectCamera(e.currentTarget.value)}>
								{#each calls.cameras as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
							</select>
						</label>
						<label class="flex items-center gap-2"><input type="checkbox" checked={calls.blur} onchange={(e) => calls.setBlur(e.currentTarget.checked)} />Blur my background</label>
					{:else if menu === 'mic'}
						<label class="grid gap-1"><span class="field-label">Microphone</span>
							<select class={select} value={calls.selected.mic ?? ''} onchange={(e) => calls.selectMic(e.currentTarget.value)}>
								{#each calls.mics as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
							</select>
						</label>
						<label class="grid gap-1"><span class="field-label">Speaker</span>
							<select class={select} value={calls.selected.speaker ?? ''} onchange={(e) => calls.selectSpeaker(e.currentTarget.value)}>
								{#each calls.speakers as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
							</select>
						</label>
					{:else}
						<button class="menu-item text-left" onclick={() => { menu = null; void (calls.onHold ? calls.resume() : calls.hold()); }}>{calls.onHold ? 'Resume call' : 'Hold call'}</button>
						{#if !popout}
							<button class="menu-item text-left" onclick={() => { menu = null; layout = layout === 'compact' ? 'docked' : 'compact'; }}>{layout === 'compact' ? 'Expand' : 'Shrink to corner'}</button>
						{/if}
					{/if}
				</div>
			{/if}
		</header>

		{#if calls.error}
			<!-- something in the call failed (share, blur, device): say so here, not on the next pre-join -->
			<p class="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-caption text-p-urgent">
				<span class="min-w-0 flex-1">{calls.error}</span>
				<button class="link-muted" onclick={() => (calls.error = null)}>Dismiss</button>
			</p>
		{/if}
		{#if calls.onHold}
			<p class="border-b border-border bg-surface-2 px-3 py-1.5 text-caption text-muted">
				On hold. <button class="text-accent hover:underline" onclick={() => calls.resume()}>Resume</button>
			</p>
		{/if}

		<div class="flex min-h-0 flex-1">
			<div class="relative min-h-0 flex-1 p-2">
				{#if alone}
					<!-- nobody else yet: you are the stage -->
					<div class="relative flex size-full items-center justify-center overflow-hidden rounded-lg bg-surface">
						{#if calls.videoOn}
							<div bind:this={self} class="size-full [&>*]:size-full"></div>
						{:else}
							<Avatar id={null} name="You" size={compact ? 48 : 96} />
						{/if}
						<p class="absolute inset-x-0 top-3 text-center text-sm text-text [text-shadow:0_1px_4px_rgb(0_0_0/0.8)]">{waiting}</p>
						<span class="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-2xs text-white">You</span>
					</div>
				{:else}
					<div class="grid h-full gap-2 {calls.tiles.length === 1 ? 'grid-rows-1' : 'content-center'}" style="grid-template-columns: repeat({cols}, minmax(0, 1fr))">
						{#each calls.tiles as t (t.key)}
							<VideoTile tile={t} {compact} fill={calls.tiles.length === 1} />
						{/each}
					</div>
					{#if calls.videoOn}
						<!-- mirrored self-view; drag it anywhere inside the stage -->
						<div
							bind:this={self}
							use:pipDrag
							class="absolute right-4 bottom-4 aspect-video w-48 overflow-hidden rounded-md border border-border bg-surface-2 shadow-lg [&>*]:pointer-events-none [&>*]:size-full"
						></div>
					{/if}
				{/if}
			</div>

			{#if showPeople}<CallRoster />{/if}
			{#if showChat}<CallChat />{/if}
		</div>
	</section>
{/if}
