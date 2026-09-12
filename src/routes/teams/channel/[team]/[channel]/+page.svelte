<script lang="ts">
	import TeamsThread from '$lib/components/TeamsThread.svelte';
	let { data } = $props();
</script>

{#key data.channel.id}
<TeamsThread title="# {data.channel.name}" subtitle={data.team.name} webUrl={data.channel.webUrl} messages={data.messages} error={data.error} target={{ team: data.team.id, channel: data.channel.id }} />
{/key}
