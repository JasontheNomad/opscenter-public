<!--
  Two strips that belong outside the call window: who is waiting in the meeting lobby, and why the
  last call ended. In-call controls live in CallView (Phase 5); this was CallBar before that.
-->
<script lang="ts">
	import { calls } from '$lib/calls/engine.svelte';
</script>

{#if calls.inCall && calls.lobby.length && calls.canAdmit}
	<!-- Teams parks people outside the meeting; nothing else in the app would show them. -->
	<div class="fixed bottom-4 left-4 z-50 w-72 rounded-lg border border-border bg-surface-2 p-3 shadow-lg">
		<div class="mb-2 flex items-center justify-between">
			<span class="text-caption text-muted">Waiting in lobby</span>
			{#if calls.lobby.length > 1}
				<button class="text-caption text-accent hover:underline" onclick={() => calls.admitAll()}>Admit all</button>
			{/if}
		</div>
		{#each calls.lobby as p (p.key)}
			<div class="flex items-center gap-2 py-1">
				<span class="min-w-0 flex-1 truncate text-sm text-text">{p.name}</span>
				<button class="rounded-md bg-avail px-2 py-0.5 text-xs text-white" onclick={() => calls.admit(p.key)}>Admit</button>
				<button class="link-muted text-xs" onclick={() => calls.rejectFromLobby(p.key)}>Deny</button>
			</div>
		{/each}
	</div>
{/if}

{#if calls.handoff}
	<!-- calling is meant to be in-app, but this click went to Teams: say why instead of just switching apps -->
	<div class="fixed bottom-4 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface-2 px-4 py-2 shadow-lg">
		<span class="text-sm text-text">Opened in Teams — {calls.handoff}</span>
		<button class="link-muted text-xs" onclick={() => (calls.handoff = null)}>Dismiss</button>
	</div>
{/if}

{#if !calls.inCall && calls.endedBecause}
	<!-- a call that dies on its own should say why -->
	<div class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface-2 px-4 py-2 shadow-lg">
		<span class="text-sm text-text">{calls.endedBecause}</span>
		<button class="link-muted text-xs" onclick={() => (calls.endedBecause = null)}>Dismiss</button>
	</div>
{/if}
