<!--
  Chat for the current call, docked beside it (Phase 5). Not a second copy of the Teams thread UI —
  it reads the same messages through /api/teams/messages (which hits the cache the poller already
  warms) and sends through the existing /api/teams/send.
-->
<script lang="ts">
	import { calls } from '$lib/calls/engine.svelte';
	import { post, errMsg } from '$lib/api';
	import { cleanHtml } from '$lib/sanitize';
	import { clock } from '$lib/format';
	import { enterSubmits } from '$lib/composer';
	import type { ChatMessage } from '$lib/server/teams/render';

	let messages = $state<ChatMessage[]>([]);
	let draft = $state('');
	let err = $state('');
	let sending = $state(false);
	let list = $state<HTMLDivElement | null>(null);

	const atBottom = () => !list || list.scrollHeight - list.scrollTop - list.clientHeight < 60;

	async function load(scroll = false) {
		const chat = calls.chatId;
		if (!chat) return;
		const stick = scroll || atBottom();
		try {
			const r = await fetch(`/api/teams/messages?chat=${encodeURIComponent(chat)}`);
			if (r.ok) messages = await r.json();
		} catch { /* the poll will try again */ }
		if (stick) requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight }));
	}

	$effect(() => {
		const chat = calls.chatId;
		if (!chat) { messages = []; return; }
		void load(true);
		// same 5s beat the open chat uses elsewhere; SSE would be nicer but this panel is short-lived
		const id = setInterval(() => void load(), 5000);
		return () => clearInterval(id);
	});

	async function send() {
		const text = draft.trim();
		if (!text || !calls.chatId) return;
		sending = true;
		err = '';
		try {
			await post('/api/teams/send', { chat: calls.chatId, text });
			draft = '';
			await load(true);
		} catch (e) {
			err = errMsg(e);
		}
		sending = false;
	}
</script>

<div class="flex w-72 shrink-0 flex-col border-l border-border">
	<div class="border-b border-border px-3 py-2 text-caption text-muted">Chat</div>

	{#if !calls.chatId}
		<p class="px-3 py-3 text-caption text-muted">This call isn't attached to a chat.</p>
	{:else}
		<div bind:this={list} class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
			{#each messages as m (m.id)}
				<div class="mb-2">
					<div class="flex items-baseline gap-1.5">
						<span class="text-2xs font-medium {m.me ? 'text-accent' : 'text-text'}">{m.me ? 'You' : m.from}</span>
						<span class="text-2xs text-muted">{clock(m.at)}</span>
					</div>
					<!-- html is sanitised server-side by render.ts, same as the main thread view -->
					<div class="teams-msg text-xs">{@html cleanHtml(m.html)}</div>
				</div>
			{:else}
				<p class="text-caption text-muted">No messages yet.</p>
			{/each}
		</div>

		<div class="border-t border-border p-2">
			{#if err}<p class="err mb-1 text-2xs">{err}</p>{/if}
			<textarea
				class="w-full resize-none rounded border border-border bg-surface-2 px-2 py-1 text-xs"
				rows="2"
				placeholder="Message…"
				bind:value={draft}
				disabled={sending}
				onkeydown={enterSubmits(() => void send())}
			></textarea>
		</div>
	{/if}
</div>
