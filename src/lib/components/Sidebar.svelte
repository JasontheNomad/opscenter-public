<script lang="ts">
	import { textStyle } from '$lib/textSize';
	import { page } from '$app/state';
	import { VIEWS, type ViewId } from '$lib/views';
	import type { StatusPayload } from '$lib/server/status';
	import { badgeCount } from '$lib/status';
	import Icon from './Icon.svelte';
	import { persistedWidth, resizable } from '$lib/resizable.svelte';

	let { counts, teams = { unread: 0 } }: { counts: Record<ViewId, number>; teams?: Partial<StatusPayload> & { unread: number } } = $props();



	// drag right edge to resize; remembered per browser
	const width = persistedWidth('sidebarWidth', 224, 160, 420);

	const active = (path: string) =>
		path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(path.split('?')[0]);
</script>


{#snippet link(href: string, name: string, icon: string, count?: number, alert?: number)}
	<a
		{href}
		class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body transition-colors {active(href)
			? 'bg-surface-2 text-text'
			: 'text-muted hover:bg-surface-2/60 hover:text-text'}"
	>
		<span class="relative">
			<Icon name={icon} />
			{#if alert}
				<span class="absolute -top-2 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert px-1 text-[9px] font-bold text-white ring-2 ring-surface">{alert > 99 ? '99+' : alert}</span>
			{/if}
		</span>
		<span class="flex-1 {alert ? 'font-semibold text-text' : ''}">{name}</span>
		{#if count}<span class="rounded-full bg-accent/20 px-1.5 text-2xs text-accent">{count}</span>{/if}
	</a>
{/snippet}

<nav class="relative flex shrink-0 flex-col border-r border-border bg-surface px-3 py-3" style="width: {width.value}px; {textStyle(page.data.textSize, 'sidebar')}">
	<div
		class="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-accent/40"
		{@attach resizable(width, 'right')}
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize sidebar"
	></div>
	<div class="mb-5 flex items-center gap-2.5 px-1.5">
		<a href="/" class="flex min-w-0 flex-1 items-center gap-2.5">
			<img src="/icon-192.png" alt="" class="size-8 rounded-lg" />
			<span class="truncate text-[calc(17px*var(--text-scale,1))] font-semibold tracking-tight">OpsCenter</span>
		</a>
	</div>

	<div class="mb-1.5 px-2.5 text-caption font-medium text-muted">Workspace</div>
	<div class="flex flex-col gap-0.5">
		{#each VIEWS as v (v.id)}
			{@render link(v.path, v.name, v.id, counts[v.id], teams.hubspot?.unseen?.[v.id] ?? 0)}
		{/each}
	</div>

	<div class="mt-5 mb-1.5 px-2.5 text-caption font-medium text-muted">Comms</div>
	{@render link('/teams', 'Teams', 'teams', undefined, badgeCount(teams))}
	{@render link('/calendar', 'Calendar', 'calendar')}

	<div class="mt-5 mb-1.5 px-2.5 text-caption font-medium text-muted">Knowledge</div>
	{@render link('/clients', 'Clients', 'clients')}

	<div class="flex-1"></div>
	{@render link('/settings', 'Settings', 'settings')}
</nav>
