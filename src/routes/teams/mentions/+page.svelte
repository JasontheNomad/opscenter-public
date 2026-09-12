<script lang="ts">
	import ActivityList from '$lib/components/ActivityList.svelte';
	let { data } = $props();
</script>
<ActivityList title={data.title} items={data.items} empty="Nobody has @mentioned you yet (tracked from now on)." />
