<!--
  Everything shown inside the call's own window (see $lib/calls/window.svelte.ts): the pre-join
  screen, then the call itself, plus the lobby list and any second call ringing.
-->
<script lang="ts">
	import { calls } from '$lib/calls/engine.svelte';
	import { page } from '$app/state';
	import { textStyle } from '$lib/textSize';
	import PreJoin from './PreJoin.svelte';
	import CallView from './CallView.svelte';
	import CallNotices from './CallNotices.svelte';
	import IncomingCall from './IncomingCall.svelte';

	let { onclose }: { onclose: () => void } = $props();
</script>

<div class="fixed inset-0 bg-bg text-text" style={textStyle(page.data.textSize, 'call')}>
	{#if calls.pending}
		<PreJoin
			title={calls.pending.title}
			sub={calls.pending.sub}
			startVideo={calls.pending.video}
			onjoin={(o) => calls.confirmPending(o)}
			oncancel={async () => { await calls.cancelPending(); onclose(); }}
		/>
	{:else if calls.inCall}
		<CallView popout />
	{:else if calls.error}
		<!-- answering failed before a call existed (caller hung up, no mic): the reason, and a way out -->
		<div class="flex h-full flex-col items-center justify-center gap-3 text-sm">
			<p class="err max-w-md text-center">{calls.error}</p>
			<button class="btn px-3 py-1 text-xs" onclick={() => { calls.error = null; onclose(); }}>Close</button>
		</div>
	{:else}
		<p class="flex h-full items-center justify-center text-sm text-muted">Connecting…</p>
	{/if}
	<CallNotices />
	<IncomingCall banners={false} />
</div>
