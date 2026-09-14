<!--
  Ring UI for inbound calls (Phase 4, docs/acs-calling-sow.md).
  Renders every ringing call, not just the first — a second call arriving mid-call gets its own row
  rather than replacing the one already on screen.
-->
<script lang="ts">
	import { calls } from '$lib/calls/engine.svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	// Mounted twice (main window + call popup), but only the main window's copy may own OS banners: the
	// popup's replaced its listener, and once the popup closed nothing was left to close a banner when
	// the call stopped ringing. The popup copy renders the ring cards only.
	let { banners: ownsBanners = true }: { banners?: boolean } = $props();

	// Same rule the rest of the app uses: no OS banner while the window is actually in front.
	const appActive = () => document.hasFocus() && document.visibilityState === 'visible';
	const canNotify = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

	// Inbound calls only reach us while the agent is registered, so the engine has to come up with the
	// app rather than on the first outbound click. inApp() is a no-op unless CALLS_ENGINE=acs, and it
	// does not ask for the mic — that prompt still waits for a real call.
	$effect(() => { void calls.inApp(); });

	// open banners by call id: requireInteraction keeps them up after the caller gives up or it's
	// answered in-app, and clicking a dead one did nothing — so close each when its call stops ringing
	const banners = new Map<string, Notification>();
	$effect(() => {
		if (!ownsBanners) return;
		return calls.onIncoming((c) => {
			if (appActive() || !canNotify()) return;
			const n = new Notification(`${c.name} is calling`, {
				body: 'Click to answer',
				tag: `call-${c.id}`,
				icon: '/icon-192.png',
				badge: '/icon-192.png',
				requireInteraction: true // a ring shouldn't time out like a chat banner
			});
			n.onclick = () => { window.focus(); void calls.accept(c.id); n.close(); };
			banners.set(c.id, n);
		});
	});
	$effect(() => {
		const ringing = new Set(calls.incoming.map((c) => c.id));
		for (const [id, n] of banners) if (!ringing.has(id)) (n.close(), banners.delete(id));
	});
</script>

{#each calls.incoming as c, i (c.id)}
	<!-- stack rather than overlap when two calls ring at once -->
	<div class="fixed right-4 z-50 flex w-72 flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4 shadow-lg" style="top:{16 + i * 116}px">
		<div class="flex items-center gap-3">
			<Avatar id={c.callerId} name={c.name} size={36} />
			<div class="min-w-0">
				<p class="truncate text-sm text-text">{c.name}</p>
				<p class="text-caption text-muted">{calls.inCall ? 'Second incoming call' : 'Incoming call'}</p>
			</div>
		</div>
		<div class="flex gap-2">
			<button class="flex-1 rounded-md bg-avail px-3 py-1.5 text-xs font-medium text-white" onclick={() => calls.accept(c.id)}>
				{calls.inCall ? 'Hold & answer' : 'Answer'}
			</button>
			<button class="flex-1 rounded-md bg-alert px-3 py-1.5 text-xs font-medium text-white" onclick={() => calls.decline(c.id)}>Decline</button>
		</div>
	</div>
{/each}
