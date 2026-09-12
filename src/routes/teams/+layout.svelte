<script lang="ts">
	import { textStyle } from '$lib/textSize';
	import { post, errMsg } from '$lib/api';
	import { calls } from '$lib/calls/engine.svelte';
	import { hue, initials } from '$lib/format';
	import { isChannelId, defaultNotifyLevel, type NotifyLevel } from '$lib/types';
	import { page, navigating } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Sortable from '$lib/components/Sortable.svelte';

	let { data, children } = $props();
	const enc = encodeURIComponent;
	type Chat = (typeof data.chats)[number];
	const title = (c: Chat) => c.topic ?? (c.members.filter((m) => m !== data.me?.displayName).join(', ') || 'Chat');
	const favSet = $derived(new Set(data.favs));

	// sections — favorites keep the order of data.favs (draggable); chats follow saved order, unknown ones by recency
	type FavItem = { id: string; chat?: Chat; team?: (typeof data.teams)[number]; ch?: (typeof data.teams)[number]['channels'][number] };
	const favItemsBase = $derived.by(() => {
		const byChat = new Map(data.chats.map((c) => [c.id, c]));
		const byCh = new Map(data.teams.flatMap((t) => t.channels.map((c) => [c.id, { team: t, ch: c }] as const)));
		return data.favs.flatMap((id): FavItem[] => byChat.has(id) ? [{ id, chat: byChat.get(id) }] : byCh.has(id) ? [{ id, ...byCh.get(id)! }] : []);
	});
	const favChats = $derived(favItemsBase.filter((f) => f.chat).map((f) => f.chat!));
	const favChannels = $derived(favItemsBase.filter((f) => f.ch).map((f) => ({ team: f.team!, ch: f.ch! })));
	const chatsBase = $derived.by(() => {
		const list = data.chats.filter((c) => !favSet.has(c.id) && c.chatType !== 'meeting');
		const pos = new Map(data.chatOrder.map((id, i) => [id, i]));
		return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
	});
	// drag state (svelte-dnd-action needs mutable arrays)
	// writable deriveds: follow the data after every poll, and a drag reassigns them in between
	let favItems = $derived<FavItem[]>(favItemsBase);
	let chats = $derived<Chat[]>(chatsBase);
	const PRESENCE = [['Available', 'Available'], ['Busy', 'Busy'], ['DoNotDisturb', 'Do not disturb'], ['BeRightBack', 'Be right back'], ['Away', 'Away'], ['Offline', 'Offline']] as const;
	async function setPresence(e: Event & { currentTarget: HTMLSelectElement }) {
		const el = e.currentTarget;
		await write('/api/teams/presence', { availability: el.value });
		el.value = '';
	}
	const saveOrder = (kind: string, ids: string[]) => write('/api/teams/order', { kind, ids });
	type TeamT = (typeof data.teams)[number];
	type ChannelT = TeamT['channels'][number];
	let teamsList = $derived<TeamT[]>(data.teams);
	// per-team channel arrays for dnd
	// svelte-ignore state_referenced_locally
	// stays $state + effect: `bind:items={chans[t.id]}` writes a property, which needs $state's deep proxy
	// eslint-disable-next-line svelte/prefer-writable-derived
	let chans = $state<Record<string, ChannelT[]>>(Object.fromEntries(data.teams.map((t) => [t.id, t.channels])));
	$effect(() => { chans = Object.fromEntries(data.teams.map((t) => [t.id, t.channels])); });

	// collapsed state, remembered
	let open = $state<Record<string, boolean>>({ fav: true, chats: true, teams: true });
	let openTeams = $state<Record<string, boolean>>({});
	$effect(() => {
		// run once; untrack so writing `open` doesn't re-trigger this effect
		untrack(() => {
			try {
				const s = localStorage.getItem('teamsSections');
				if (s) open = { ...open, ...JSON.parse(s) };
				const t = localStorage.getItem('teamsOpenTeams');
				if (t) openTeams = JSON.parse(t);
			} catch {}
		});
	});
	const toggle = (k: string) => {
		open[k] = !open[k];
		try { localStorage.setItem('teamsSections', JSON.stringify(open)); } catch {}
	};
	const toggleTeam = (id: string) => {
		openTeams[id] = !openTeams[id];
		try { localStorage.setItem('teamsOpenTeams', JSON.stringify(openTeams)); } catch {}
	};

	// Every sidebar write goes through here: a failure says why and re-reads the server, which undoes the
	// optimistic change (a drag, a menu pick, the status select) instead of leaving it on screen unsaved.
	let writeError = $state('');
	async function write(path: string, body: unknown) {
		writeError = '';
		try {
			await post(path, body);
		} catch (e) {
			writeError = errMsg(e);
		}
		await invalidateAll();
	}
	const fav = (id: string, on: boolean) => write('/api/teams/fav', { id, on });

	const activeChat = $derived(decodeURIComponent(page.params.chat ?? ''));
	const activeChannel = $derived(decodeURIComponent(page.params.channel ?? ''));

	// filter chips
	type Filter = 'all' | 'unread' | 'chats' | 'channels';
	let filter = $state<Filter>('all');
	$effect(() => {
		const f = page.url.searchParams.get('filter') as Filter | null;
		if (f && ['all', 'unread', 'chats', 'channels'].includes(f)) filter = f;
	});
	const showChats = $derived(filter === 'all' || filter === 'chats' || filter === 'unread');
	const showChannels = $derived(filter === 'all' || filter === 'channels' || filter === 'unread');
	const passChat = (c: Chat) => filter !== 'unread' || c.unread;

	// channel unread comes from the server poller (seen time stored server-side when a channel is opened)
	const unreadCh = $derived(new Set(data.unreadChannelIds));
	const chUnread = (id: string) => unreadCh.has(id);
	const levelOf = (id: string): NotifyLevel => (data.notify[id] as NotifyLevel | undefined) ?? defaultNotifyLevel(id);
	// (muted rows still go bold; they just don't count or banner)

	// notification level menu
	let menuFor = $state<string | null>(null);
	function closeMenu(e: Event) { if (menuFor && !(e.target as HTMLElement).closest('[data-notify-menu]')) menuFor = null; }
	function setLevel(id: string, level: NotifyLevel) {
		menuFor = null;
		return write('/api/teams/notify', { id, level });
	}
	const LEVELS: [string, string, string][] = [['all', 'bell', 'All — banner + bubble + bold'], ['quiet', 'bell-off', 'Quiet — bubble + bold, no banner'], ['off', 'ban', 'Mute — bold only']];
	const teamUnread = (t: TeamT) => t.channels.filter((c) => unreadCh.has(c.id)).length;
	const favUnread = $derived(favItems.filter((f) => (f.chat && f.chat.unread) || (f.ch && unreadCh.has(f.ch.id))).length);
	const chatsUnread = $derived(chats.filter((c) => c.unread).length);
	const teamsUnread = $derived(teamsList.reduce((n, t) => n + teamUnread(t), 0));
	// presence dot color
	const presColor = (a?: string) => (a === 'Available' ? 'var(--color-avail)' : a === 'Busy' || a === 'DoNotDisturb' ? 'var(--color-busy)' : a === 'Away' || a === 'BeRightBack' ? 'var(--color-away)' : a ? 'var(--color-muted)' : null);
	const passChannel = (id: string) => filter !== 'unread' || chUnread(id);


	const connected = $derived(data.connected);
	$effect(() => {
		if (!connected) return; // value-compared: don't tear down the EventSource on every invalidate
		// Never invalidate mid-navigation: SvelteKit lets the invalidation win and drops the click's
		// navigation — and opening an unread chat marks it read, which pushes `chats` right then.
		// The navigation reloads this layout anyway.
		const reload = () => { if (!navigating.to) void invalidateAll(); };
		const id = setInterval(reload, 20_000);
		// live push from the server poller → refresh immediately. Arrives over the root layout's
		// EventSource rather than a second connection of our own.
		const refresh = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t === 'chats' || t === 'channels') reload(); };
		addEventListener('oc:teams', refresh);
		return () => { clearInterval(id); removeEventListener('oc:teams', refresh); };
	});
</script>

<svelte:window onpointerdowncapture={closeMenu} />

{#snippet section(key: string, label: string, unread: number = 0)}
	<div class="mx-1 mt-2 border-t border-border"></div>
	<button class="mt-1.5 mb-0.5 flex w-full items-center gap-1.5 px-2 py-1 text-body {unread ? 'font-semibold text-text' : 'text-muted'} hover:text-text" onclick={() => toggle(key)}>
		<span class="inline-block w-3 text-2xs transition-transform {open[key] ? 'rotate-90' : ''}">▶</span>{label}
	</button>
{/snippet}

{#snippet notifyMenu(id: string)}
	{@const lv = levelOf(id)}
	{@const nonDefault = lv !== defaultNotifyLevel(id)}
	<div class="relative shrink-0" data-notify-menu>
		<button class="flex size-5 items-center justify-center rounded {nonDefault ? 'text-muted' : 'text-muted opacity-0 group-hover:opacity-100'} hover:text-text" title="Notifications: {lv}" onclick={(e) => { e.preventDefault(); e.stopPropagation(); menuFor = menuFor === id ? null : id; }}>{#if nonDefault}<Icon name={LEVELS.find(([k]) => k === lv)?.[1] ?? 'bell'} class="size-3.5" />{:else}<Icon name="dots" class="size-3.5" />{/if}</button>
		{#if menuFor === id}
			<div class="menu w-56">
				<div class="px-2 py-1 text-2xs text-muted uppercase">Move to section</div>
				{#each [[true, 'Favorites'], [false, isChannelId(id) ? 'Teams & channels' : 'Chats']] as [on, label] (label)}
					<button class="menu-item {favSet.has(id) === on ? 'nav-active' : 'menu-idle'}" onclick={(e) => { e.preventDefault(); e.stopPropagation(); menuFor = null; void fav(id, on as boolean); }}><Icon name={on ? 'star' : 'list'} class="size-3.5" /> {label}</button>
				{/each}
				<div class="mx-1 my-1 border-t border-border"></div>
				<div class="px-2 py-1 text-2xs text-muted uppercase">Notify me</div>
				{#each LEVELS as [lv, icon, label] (lv)}
					<button class="menu-item {levelOf(id) === lv ? 'nav-active' : 'menu-idle'}" onclick={(e) => { e.preventDefault(); e.stopPropagation(); void setLevel(id, lv as NotifyLevel); }}><Icon name={icon} class="size-3.5" /> {label}{#if lv === defaultNotifyLevel(id)}<span class="ml-auto text-2xs text-muted">default</span>{/if}</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet teamChannelRow(ch: ChannelT)}
	{@const t = teamsList.find((x) => x.channels.some((c) => c.id === ch.id))!}
	{@render channelRow(t, ch, false)}
{/snippet}
{#snippet favRow(f: FavItem)}
	{#if f.chat}{@render chatRow(f.chat)}{:else if f.ch}{@render channelRow(f.team!, f.ch, true)}{/if}
{/snippet}
{#snippet teamBlock(t: TeamT)}
	{@const tu = teamUnread(t)}
		<button class="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-body {tu ? 'font-semibold text-text' : 'text-text'} hover:bg-surface-2/60" onclick={() => toggleTeam(t.id)}>
			<span class="inline-block w-3 text-2xs text-muted transition-transform {openTeams[t.id] ? 'rotate-90' : ''}">▶</span>
			<span class="flex size-6 shrink-0 items-center justify-center rounded-md text-2xs font-bold text-white" style="background: hsl({hue(t.name)} 55% 45%)">{initials(t.name)}</span>
			<span class="truncate">{t.name}</span>
		</button>
		{#if openTeams[t.id]}
			{#if filter === 'all' && chans[t.id]}
				<Sortable class="ml-5" bind:items={chans[t.id]} onreorder={(ids) => saveOrder(`channels:${t.id}`, ids)} row={teamChannelRow} />
			{:else}
				<div class="ml-5">{#each t.channels.filter((c) => passChannel(c.id)) as ch (ch.id)}{@render channelRow(t, ch, false)}{/each}</div>
			{/if}
		{/if}
{/snippet}

{#snippet chatRow(c: Chat)}
	{@const others = c.people.filter((p) => p.id !== data.me?.id)}
	<a href="/teams/{enc(c.id)}" class="group flex h-9 items-center gap-2.5 rounded-md px-2 {activeChat === c.id ? 'bg-surface-2 ring-1 ring-border-2' : 'hover:bg-surface-2/60'}">
		<div class="relative size-7 shrink-0">
			{#if c.chatType === 'oneOnOne'}
				<Avatar id={others[0]?.id ?? null} name={title(c)} size={28} />
				{@const pc = presColor(data.presence[others[0]?.id ?? ''])}
				{#if pc}<span class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface" style="background: {pc}"></span>{/if}
			{:else if c.chatType === 'meeting'}
				<div class="flex size-7 items-center justify-center rounded-full bg-surface-2 text-muted"><Icon name="calendar" class="size-3.5" /></div>
			{:else}
				<div class="absolute top-0 left-0"><Avatar id={others[0]?.id ?? null} name={others[0]?.name ?? '?'} size={19} /></div>
				<div class="absolute right-0 bottom-0 rounded-full ring-2 ring-surface"><Avatar id={others[1]?.id ?? null} name={others[1]?.name ?? '?'} size={19} /></div>
			{/if}
		</div>
		<span class="min-w-0 flex-1 truncate text-body {c.unread ? 'font-semibold text-text' : 'text-muted group-hover:text-text'}">{title(c)}</span>
		{#if c.unread}<span class="size-2 shrink-0 rounded-full bg-teams" title="Unread"></span>{/if}
		{@render notifyMenu(c.id)}
	</a>
{/snippet}

{#snippet channelRow(t: (typeof data.teams)[number], ch: (typeof data.teams)[number]['channels'][number], showTeam: boolean)}
	<a href="/teams/channel/{enc(t.id)}/{enc(ch.id)}" class="group flex h-9 items-center gap-2.5 rounded-md px-2 {activeChannel === ch.id ? 'bg-surface-2 ring-1 ring-border-2' : 'hover:bg-surface-2/60'}" title={t.name}>
		{#if showTeam}
			<span class="flex size-7 shrink-0 items-center justify-center rounded-md text-2xs font-bold text-white" style="background: hsl({hue(t.name)} 55% 45%)">{initials(t.name)}</span>
		{:else}
			<span class="w-7 shrink-0 text-center text-muted">#</span>
		{/if}
		<span class="min-w-0 flex-1 truncate text-body {chUnread(ch.id) ? 'font-semibold text-text' : 'text-muted group-hover:text-text'}">{ch.name}</span>
		{#if ch.membershipType === 'private'}<span class="flex size-5 shrink-0 items-center justify-center text-muted" title="Private channel"><Icon name="lock" class="size-3.5" /></span>{/if}
		{@render notifyMenu(ch.id)}
	</a>
{/snippet}

<!-- Loading a chat or channel marks it read (here and in Teams), so its data may only load on the
     click itself — "tap" = on press. Code still preloads on hover, so the switch stays fast. -->
<div class="flex min-w-0 flex-1" data-sveltekit-preload-data="tap" data-sveltekit-preload-code="hover">
	{#if !data.configured}
		<div class="m-auto max-w-md text-center text-xs text-muted">Teams not configured. Add <code>TEAMS_CLIENT_ID</code> + <code>TEAMS_TENANT_ID</code> to <code>.env</code> and restart.</div>
	{:else if !data.connected}
		<div class="m-auto text-center">
			<a href="/auth/teams/start" class="btn-primary px-4 py-2 text-sm">Sign in to Microsoft Teams</a>
		</div>
	{:else}
		<aside class="flex w-72 shrink-0 flex-col border-r border-border" style={textStyle(data.textSize, 'teamsList')}>
			<div class="pane-header gap-2 px-3">
				<span class="flex-1 text-sm font-semibold">Teams</span>
				<select class="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-caption text-muted focus:outline-none" title="Set my status (needs a Teams presence session)" onchange={setPresence}>
					<option value="">{PRESENCE.find(([k]) => k === data.myPresence)?.[1] ?? 'status…'}</option>
					{#each PRESENCE as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
				<form method="POST" action="/auth/teams/logout" onsubmit={() => calls.dispose()}><button class="text-caption link-muted">sign out</button></form>
			</div>
			{#if data.error}<p class="p-3 text-xs text-p-urgent">{data.error}</p>{/if}
			{#if writeError}<p class="px-3 pt-2 text-xs text-p-urgent">Not saved: {writeError} <button class="link-muted underline" onclick={() => (writeError = '')}>Dismiss</button></p>{/if}
			<div class="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
				{#each ([['all', 'All'], ['unread', 'Unread'], ['chats', 'Chats'], ['channels', 'Channels']] as const) as [id, label] (id)}
					<button class="rounded-full border px-2.5 py-0.5 text-caption {filter === id ? 'border-accent bg-accent/15 text-text' : 'border-border link-muted'}" onclick={() => (filter = id)}>{label}</button>
				{/each}
			</div>
			<div class="flex-1 overflow-y-auto px-2 pb-4">
				<div class="mt-1 mb-0.5 px-2 py-1 text-body text-muted">Quick views</div>
				{#each [['/teams/mentions', '@', 'Mentions', data.mentions], ['/teams/threads', 'reply', 'Followed threads', data.threads]] as [href, icon, label, n] (href)}
					<a href={href as string} class="flex h-9 items-center gap-2.5 rounded-md px-2 text-body {page.url.pathname === href ? 'bg-surface-2 text-text' : n ? 'font-semibold text-text hover:bg-surface-2/60' : 'text-muted hover:bg-surface-2/60 hover:text-text'}">
						<span class="flex size-7 items-center justify-center rounded-full bg-surface-2 text-body">{#if icon === '@'}@{:else}<Icon name={icon as string} class="size-3.5" />{/if}</span>
						<span class="flex-1">{label}</span>
						{#if n}<span class="badge-alert">{n}</span>{/if}
					</a>
				{/each}
				{@render section('fav', 'Favorites', favUnread)}
				{#if open.fav}
					{#if filter === 'all'}
						<Sortable bind:items={favItems} onreorder={(ids) => saveOrder('favs', ids)} row={favRow} />
					{:else}
						{#each favChats.filter(passChat) as c (c.id)}{#if showChats}{@render chatRow(c)}{/if}{/each}
						{#if showChannels}{#each favChannels.filter((f) => passChannel(f.ch.id)) as f (f.ch.id)}{@render channelRow(f.team, f.ch, true)}{/each}{/if}
					{/if}
					{#if !favItems.length}<p class="px-2 text-caption text-muted">⋯ on a chat → Move to section → Favorites · drag to reorder</p>{/if}
				{/if}

				{#if showChats}
					{@render section('chats', 'Chats', chatsUnread)}
					{#if open.chats}
						{#if filter === 'all'}
							<Sortable bind:items={chats} onreorder={(ids) => saveOrder('chats', ids)} row={chatRow} />
						{:else}
							{#each chats.filter(passChat) as c (c.id)}{@render chatRow(c)}{/each}
						{/if}
					{/if}
				{/if}


				{#if showChannels}
					{@render section('teams', 'Teams & channels', teamsUnread)}
					{#if open.teams}
						<Sortable bind:items={teamsList} disabled={filter !== 'all'} onreorder={(ids) => saveOrder('teams', ids)} row={teamBlock} />
					{/if}
				{/if}
			</div>
		</aside>
		<div class="flex min-w-0 flex-1" style={textStyle(data.textSize, 'teamsChat')}>{@render children()}</div>
	{/if}
</div>
