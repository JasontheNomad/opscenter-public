<script lang="ts">
	import ActivityList from '$lib/components/ActivityList.svelte';
	let { data } = $props();
</script>
<ActivityList title={data.title} items={data.items} empty="No new replies in threads you posted in or were mentioned in." />
