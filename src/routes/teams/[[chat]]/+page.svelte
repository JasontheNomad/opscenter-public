<script lang="ts">
	import TeamsThread from '$lib/components/TeamsThread.svelte';
	let { data } = $props();
	const title = $derived(
		data.chat ? (data.chat.topic ?? data.chat.members.filter((m) => m !== data.me?.displayName).join(', ')) : ''
	);
</script>

{#if data.chat}
	{#key data.chat.id}
	<TeamsThread {title} subtitle={data.chat.chatType} webUrl={data.chat.webUrl} messages={data.messages} error={data.error} target={{ chat: data.chat.id }} callEmails={data.chat.people.filter((p) => p.id !== data.me?.id && p.email).map((p) => p.email!)} callPeople={data.chat.people.filter((p) => p.id !== data.me?.id).map((p) => ({ id: p.id, name: p.name }))} />
	{/key}
{:else}
	<div class="flex flex-1 items-center justify-center text-xs text-muted">{data.error ?? 'Pick a chat.'}</div>
{/if}
