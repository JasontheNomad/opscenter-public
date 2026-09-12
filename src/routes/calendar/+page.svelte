<script lang="ts">
	import { textStyle } from '$lib/textSize';
	import { ymd } from '$lib/dates';
	import { clock, hourLabel } from '$lib/format';
	import { api, post, errMsg } from '$lib/api';
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import type { CalEvent } from '$lib/server/teams';
	import NewEvent from '$lib/components/NewEvent.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { joinMeeting, meetNow as startMeetNow } from '$lib/calls/join';

	let { data } = $props();

	const HOURS = Array.from({ length: 14 }, (_, i) => i + 6); // 6am–8pm
	const H = 56; // px per hour
	const weekStart = $derived(new Date(data.weekStart));
	const days = $derived(Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; }));
	let now = $state(new Date()); // bumped by the poll so the red line / today highlight move
	const today = $derived(now.toDateString());
	const fmtRange = (e: CalEvent) => `${new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${clock(e.start)} – ${clock(e.end)}`;
	const title = $derived(`${days[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`);

	function shift(n: number) {
		const d = new Date(weekStart); d.setDate(d.getDate() + n * 7 + 1); // +1: land inside the target week (weekStart is Sunday 00:00, DST-safe)
		void goto(`/calendar?d=${ymd(d)}`);
	}
	const forDay = (d: Date) => data.events.filter((e) => !e.allDay && new Date(e.start).toDateString() === d.toDateString());
	// all-day events arrive as UTC midnight -> compare the date part, not the local instant
	const allDay = (d: Date) => data.events.filter((e) => e.allDay && e.start.slice(0, 10) === ymd(d));
	const top = (e: CalEvent) => { const s = new Date(e.start); return ((s.getHours() + s.getMinutes() / 60) - HOURS[0]) * H; };
	const height = (e: CalEvent) => Math.max(22, ((new Date(e.end).getTime() - new Date(e.start).getTime()) / 3600_000) * H - 2);
	const nowTop = $derived(((now.getHours() + now.getMinutes() / 60) - HOURS[0]) * H);

	let selected = $state<CalEvent | null>(null);
	let busy = $state('');
	let err = $state('');
	async function respond(action: 'accept' | 'decline' | 'tentativelyAccept') {
		if (!selected) return;
		busy = action; err = '';
		await post('/api/calendar/respond', { id: selected.id, action }).catch((e) => (err = errMsg(e)));
		busy = '';
		await invalidateAll();
		selected = data.events.find((e) => e.id === selected?.id) ?? null;
	}
	async function meetNow() {
		busy = 'meetnow'; err = '';
		await startMeetNow().catch((e) => (err = errMsg(e)));
		busy = '';
	}
	const openMeeting = (url: string, title?: string, sub?: string) => void joinMeeting(url, title, sub);
	// new meeting dialog
	let showNew = $state(false);
	let newAt = $state<Date | undefined>(undefined);
	function openNew(at?: Date) { newAt = at; showNew = true; }
	// edit dialog: one occurrence, or the series master (every event)
	let editing = $state<{ id: string; series: boolean } | null>(null);
	// cancel confirm (inline in the side panel): one occurrence or the whole series
	let cancelling = $state<{ id: string; series: boolean } | null>(null);
	let cancelNote = $state('');
	// a confirm belongs to one event: picking another drops it (keyed on id — the 60s poll swaps the object)
	const selectedId = $derived(selected?.id);
	$effect(() => { selectedId; cancelling = null; cancelNote = ''; });
	async function cancelMeeting() {
		if (!cancelling) return;
		busy = 'cancel'; err = '';
		try {
			await api(`/api/calendar/event/${encodeURIComponent(cancelling.id)}`, 'DELETE', { comment: cancelNote });
			cancelling = null; cancelNote = ''; selected = null;
			await invalidateAll();
		} catch (e) { err = errMsg(e); }
		busy = '';
	}
	const respLabel: Record<string, string> = { accepted: 'Accepted', declined: 'Declined', tentativelyAccepted: 'Tentative', notResponded: "Didn't respond", organizer: 'Organizer', none: '' };
	const respColor = (r: string) => r === 'accepted' || r === 'organizer' ? 'border-l-accent' : r === 'declined' ? 'border-l-p-urgent opacity-60' : r === 'tentativelyAccepted' ? 'border-l-p-high' : 'border-l-muted';
	function keys(e: KeyboardEvent) { if (e.key === 'Escape') { selected = null; showNew = false; editing = null; } }

	// refresh every 60s while on the page (keeps the selected event in sync)
	$effect(() => {
		if (!data.connected) return;
		const id = setInterval(async () => {
			now = new Date();
			await invalidate('app:calendar'); // just this page's week — the root layout doesn't need it
			if (selected) selected = data.events.find((e) => e.id === selected?.id) ?? selected;
		}, 60_000);
		return () => clearInterval(id);
	});
</script>

<svelte:window onkeydown={keys} />

<div class="flex min-w-0 flex-1" style={textStyle(data.textSize, 'calendar')}>
	{#if !data.connected}
		<div class="m-auto text-center"><a href="/auth/teams/start" class="btn-primary px-4 py-2 text-sm">Sign in to Microsoft Teams</a></div>
	{:else}
		<section class="flex min-w-0 flex-1 flex-col">
			<header class="pane-header gap-2 px-4">
				<span class="text-sm font-semibold">Calendar</span>
				<button class="ml-3 rounded-md border border-border px-2.5 py-1 text-xs link-muted" onclick={() => goto('/calendar')}>Today</button>
				<button class="rounded-md px-2 py-1 link-muted" onclick={() => shift(-1)}>‹</button>
				<button class="rounded-md px-2 py-1 link-muted" onclick={() => shift(1)}>›</button>
				<span class="text-body text-text">{title}</span>
				<span class="flex-1"></span>
				<!-- an action's error, else the week's load error (otherwise a failed fetch looks like an empty week) -->
				{#if err || data.error}<span class="max-w-xs truncate err" title={err || data.error}>{err || `Couldn't load the week: ${data.error}`}</span>{/if}
				<button class="btn flex items-center gap-1.5 px-3 py-1 text-xs text-text hover:border-accent" disabled={busy === 'meetnow'} onclick={meetNow}><Icon name="video" class="size-3.5" />Meet now</button>
				<button class="btn-primary px-3 py-1 text-xs" onclick={() => openNew()}>+ New meeting</button>
			</header>

			<div class="flex-1 overflow-auto">
				<div class="grid min-w-[840px]" style="grid-template-columns: 56px repeat(7, 1fr)">
					<!-- day headers -->
					<div class="sticky top-0 z-20 border-b border-border bg-bg"></div>
					{#each days as d (d.toISOString())}
						<div class="sticky top-0 z-20 border-b border-l border-border bg-bg px-2 py-2 {d.toDateString() === today ? 'text-accent' : 'text-text'}">
							<div class="text-lg leading-none font-semibold">{d.getDate()}</div>
							<div class="text-caption text-muted">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
							{#each allDay(d) as e (e.id)}
								<button class="mt-1 block w-full truncate rounded border-l-2 bg-surface-2 px-1 text-left text-caption {respColor(e.response)}" onclick={() => (selected = e)}>{e.subject}</button>
							{/each}
						</div>
					{/each}
					<!-- hour rows -->
					<div class="relative" style="height: {HOURS.length * H}px">
						{#each HOURS as h (h)}
							<div class="absolute right-2 -translate-y-1/2 text-caption text-muted" style="top: {(h - HOURS[0]) * H}px">{hourLabel(h)}</div>
						{/each}
					</div>
					{#each days as d (d.toISOString())}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="relative border-l border-border" style="height: {HOURS.length * H}px" ondblclick={(e) => { const y = e.offsetY; const at = new Date(d); at.setHours(HOURS[0] + Math.floor(y / H), Math.floor((y % H) / (H / 2)) * 30, 0, 0); openNew(at); }}>
							{#each HOURS as h (h)}<div class="absolute right-0 left-0 border-t border-border/60" style="top: {(h - HOURS[0]) * H}px"></div>{/each}
							{#if d.toDateString() === today}<div class="absolute right-0 left-0 z-10 border-t-2 border-p-urgent" style="top: {nowTop}px"></div>{/if}
							{#each forDay(d) as e (e.id)}
								<button
									class="absolute right-1 left-1 overflow-hidden rounded-md border-l-[3px] bg-accent/20 px-1.5 py-0.5 text-left text-caption leading-tight hover:bg-accent/30 {respColor(e.response)} {selected?.id === e.id ? 'ring-1 ring-accent' : ''} {e.cancelled ? 'line-through' : ''}"
									style="top: {top(e)}px; height: {height(e)}px"
									onclick={() => (selected = e)}
								>
									<div class="truncate font-medium text-text">{e.subject}</div>
									<div class="truncate text-muted">{clock(e.start)}{#if e.joinUrl} · Teams{/if}</div>
								</button>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</section>

		{#if selected}
			<aside class="flex w-96 shrink-0 flex-col border-l border-border bg-surface">
				<header class="pane-header gap-2 px-4">
					<span class="flex-1 truncate text-sm font-semibold">{selected.subject}</span>
					<button class="link-muted" onclick={() => (selected = null)} aria-label="Close">✕</button>
				</header>
				<div class="flex flex-col gap-4 p-4 text-xs">
					<div class="flex gap-2">
						{#if selected.joinUrl}<button onclick={() => openMeeting(selected!.joinUrl!, selected!.subject, fmtRange(selected!))} class="btn-primary flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium"><Icon name="video" class="size-4" />Join</button>{/if}
						<a href="/teams" class="btn flex items-center gap-1.5 px-3 py-1.5 text-sm text-text hover:border-accent"><Icon name="message" class="size-4" />Chat</a>
						<a href={selected.webLink} target="_blank" rel="noreferrer" class="self-center text-caption text-accent hover:underline">Outlook ↗</a>
					</div>
					<div class="text-text">🕒 {fmtRange(selected)}{#if selected.recurring} <span class="text-muted">· Series</span>{/if}</div>
					{#if selected.location}<div class="flex items-center gap-1.5 text-muted"><Icon name="pin" class="size-3.5" />{selected.location}</div>{/if}
					<div class="text-muted">👤 {selected.isOrganizer ? 'You organize' : `${selected.organizer} invited you`} · {selected.attendees} attendee{selected.attendees === 1 ? '' : 's'}</div>
					{#if selected.isOrganizer && !selected.cancelled}
						<!-- the editor is time-based: all-day starts arrive as UTC midnight (the day before, in US zones)
						     and Graph rejects a non-midnight all-day time, so edit those in Outlook -->
						{#if !selected.allDay}
						<div class="flex gap-2">
							<button class="btn px-3 py-1 hover:border-accent" onclick={() => (editing = { id: selected!.id, series: false })}>Edit{selected.recurring ? ' this event' : ''}</button>
							{#if selected.recurring && selected.seriesId}<button class="btn px-3 py-1 hover:border-accent" onclick={() => (editing = { id: selected!.seriesId!, series: true })}>Edit series</button>{/if}
						</div>
						{/if}
						<div class="flex gap-2">
							<button class="btn px-3 py-1 text-p-urgent hover:border-p-urgent" onclick={() => (cancelling = { id: selected!.id, series: false })}>Cancel{selected.recurring ? ' this event' : ' meeting'}</button>
							{#if selected.recurring && selected.seriesId}<button class="btn px-3 py-1 text-p-urgent hover:border-p-urgent" onclick={() => (cancelling = { id: selected!.seriesId!, series: true })}>Cancel series</button>{/if}
						</div>
						{#if cancelling}
							<div class="flex flex-col gap-2 rounded-md border border-p-urgent/60 p-3">
								<div class="text-text">{cancelling.series ? 'Cancel every event in this series?' : 'Cancel this meeting?'}{selected.attendees ? ' Attendees get a cancellation email.' : ''} This can't be undone.</div>
								{#if selected.attendees}<textarea bind:value={cancelNote} rows="2" placeholder="Message to attendees (optional)" class="resize-none rounded-md bg-surface-2 px-2 py-1 text-text placeholder:text-muted focus:outline-none"></textarea>{/if}
								<div class="flex gap-2">
									<button class="btn px-3 py-1 text-p-urgent hover:border-p-urgent" disabled={!!busy} onclick={cancelMeeting}>{busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}</button>
									<button class="btn px-3 py-1 hover:border-accent" onclick={() => { cancelling = null; cancelNote = ''; }}>Keep it</button>
								</div>
							</div>
						{/if}
					{/if}
					{#if selected.response && respLabel[selected.response]}<div class="text-muted">Status: <span class="text-text">{respLabel[selected.response]}</span></div>{/if}
					{#if !selected.isOrganizer}
						<div class="flex gap-2">
							<button class="btn px-3 py-1 hover:border-accent" disabled={!!busy} onclick={() => respond('accept')}>✓ Accept</button>
							<button class="btn px-3 py-1 hover:border-accent" disabled={!!busy} onclick={() => respond('tentativelyAccept')}>? Tentative</button>
							<button class="btn px-3 py-1 text-p-urgent hover:border-p-urgent" disabled={!!busy} onclick={() => respond('decline')}>✕ Decline</button>
						</div>
					{/if}
					{#if selected.preview}<p class="whitespace-pre-wrap text-muted">{selected.preview}</p>{/if}
				</div>
			</aside>
		{/if}

		{#if showNew}
			<NewEvent events={data.events} initial={newAt} onclose={() => (showNew = false)} oncreated={async () => { showNew = false; await invalidateAll(); }} />
		{/if}
		{#if editing}
			<NewEvent events={data.events} edit={editing} onclose={() => (editing = null)} oncreated={async () => { editing = null; selected = null; await invalidateAll(); }} />
		{/if}
	{/if}
</div>
