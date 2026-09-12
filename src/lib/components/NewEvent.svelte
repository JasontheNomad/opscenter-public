<script lang="ts">
	import { api, post, errMsg } from '$lib/api';
	import { clock, hourLabel, initials } from '$lib/format';
	import { isEmail } from '$lib/types';
	import Icon from '$lib/components/Icon.svelte';
	// Teams-style "New event" dialog with live day preview
	import type { CalEvent } from '$lib/server/teams';

	// `edit` = an existing meeting: `id` is one occurrence, or the series master when `series` (every event)
	let { events, onclose, oncreated, initial, edit }: { events: CalEvent[]; onclose: () => void; oncreated: () => void; initial?: Date; edit?: { id: string; series: boolean } } = $props();

	const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	const roundUp = (d: Date) => { const r = new Date(d); r.setMinutes(Math.ceil(r.getMinutes() / 30) * 30, 0, 0); return r; };
	// svelte-ignore state_referenced_locally
	const s0 = roundUp(initial ?? new Date());

	let subject = $state('');
	let date = $state(localInput(s0).slice(0, 10));
	let startT = $state(localInput(s0).slice(11, 16));
	let endT = $state(localInput(new Date(s0.getTime() + 30 * 60_000)).slice(11, 16));
	let location = $state('');
	let online = $state(true);
	let body = $state('');
	let attendees = $state<{ name: string; mail: string }[]>([]);
	let busy = $state(false);
	let err = $state('');

	const start = $derived(new Date(`${date}T${startT}`));
	const end = $derived(new Date(`${date}T${endT}`));
	// edit mode: load the meeting, remember what it was so only real changes are sent
	// svelte-ignore state_referenced_locally
	let loading = $state(!!edit);
	const valid = $derived(subject.trim().length > 0 && end > start && !loading);
	let orig = { date: '', startT: '', endT: '', body: '' };
	$effect(() => {
		if (!edit) return;
		const { id } = edit;
		api<{ subject: string; start: string; end: string; location: string; body: string; online: boolean; attendees: { name: string; mail: string }[] }>(`/api/calendar/event/${encodeURIComponent(id)}`)
			.then((m) => {
				const s = localInput(new Date(m.start)), e = localInput(new Date(m.end));
				subject = m.subject; location = m.location; body = m.body; online = m.online; attendees = m.attendees;
				date = s.slice(0, 10); startT = s.slice(11, 16); endT = e.slice(11, 16);
				orig = { date, startT, endT, body };
			})
			.catch((e) => (err = errMsg(e)))
			.finally(() => (loading = false));
	});

	// attendee search
	let q = $state('');
	let hits = $state<{ id: string; name: string; mail: string }[]>([]);
	let active = $state(0);
	let timer: ReturnType<typeof setTimeout>;
	function onQ(v: string) {
		q = v;
		clearTimeout(timer);
		if (v.trim().length < 2) { hits = []; return; }
		timer = setTimeout(async () => {
			const people = await api<typeof hits>(`/api/calendar/people?q=${encodeURIComponent(v.trim())}`).catch(() => []);
			hits = people.filter((h) => !attendees.some((a) => a.mail === h.mail));
			active = 0;
		}, 200);
	}
	function pick(h: { name: string; mail: string }) {
		if (!attendees.some((a) => a.mail === h.mail)) attendees = [...attendees, { name: h.name, mail: h.mail }];
		q = ''; hits = [];
	}
	function qKeys(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') (e.preventDefault(), (active = Math.min(active + 1, hits.length - 1)));
		else if (e.key === 'ArrowUp') (e.preventDefault(), (active = Math.max(active - 1, 0)));
		else if (e.key === 'Enter') {
			e.preventDefault();
			if (hits[active]) pick(hits[active]);
			else if (isEmail(q.trim())) pick({ name: q.trim(), mail: q.trim() });
		} else if (e.key === 'Backspace' && !q && attendees.length) attendees = attendees.slice(0, -1);
	}

	async function save() {
		if (!valid || busy) return;
		busy = true; err = '';
		try {
			if (edit) {
				// times go as local wall time + IANA zone so a moved series keeps its hour across DST
				const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
				const moved = date !== orig.date || startT !== orig.startT || endT !== orig.endT;
				await api(`/api/calendar/event/${encodeURIComponent(edit.id)}`, 'PATCH', {
					subject: subject.trim(), attendees: attendees.map((a) => a.mail), location,
					...(body !== orig.body ? { body } : {}),
					...(moved ? { start: { dateTime: `${date}T${startT}:00`, timeZone }, end: { dateTime: `${date}T${endT}:00`, timeZone } } : {})
				});
			} else await post('/api/calendar/new', { subject: subject.trim(), start: start.toISOString(), end: end.toISOString(), attendees: attendees.map((a) => a.mail), location, body, online });
			oncreated();
		} catch (e) {
			err = errMsg(e);
		}
		busy = false;
	}

	// day preview
	const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6am–10pm
	const H = 40;
	const dayEvents = $derived(events.filter((e) => !e.allDay && new Date(e.start).toDateString() === start.toDateString()));
	const top = (d: Date) => ((d.getHours() + d.getMinutes() / 60) - HOURS[0]) * H;
	const hgt = (a: Date, b: Date) => Math.max(18, ((b.getTime() - a.getTime()) / 3600_000) * H - 2);
	const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
	let previewEl: HTMLDivElement | undefined = $state();
	$effect(() => { start; previewEl?.scrollTo({ top: Math.max(0, top(start) - 120) }); });
</script>

<button class="fixed inset-0 z-40 bg-black/60" onclick={onclose} aria-label="close"></button>
<div class="fixed top-1/2 left-1/2 z-50 flex h-[min(88vh,760px)] w-[min(94vw,1000px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-bg shadow-2xl">
	<header class="pane-header gap-3 px-4">
		<span class="text-sm text-muted">{!edit ? 'New event' : edit.series ? 'Edit series — every event' : 'Edit event'}{loading ? ' · loading…' : ''}</span>
		<span class="flex-1"></span>
		{#if err}<span class="max-w-md truncate err" title={err}>{err}</span>{/if}
		<button class="btn-primary px-4 py-1.5 text-sm font-medium" disabled={!valid || busy} onclick={save}>{busy ? 'Saving…' : '💾 Save'}</button>
		<button class="ml-1 link-muted" onclick={onclose} aria-label="Close">✕</button>
	</header>

	<div class="flex min-h-0 flex-1">
		<!-- form -->
		<div class="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-5">
			<div class="rounded-lg bg-surface p-4">
				<div class="flex items-center gap-3 border-b-2 border-accent/70 pb-2">
					<span class="w-6 text-center text-muted">🗓</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={subject} placeholder="Add title" autofocus class="min-w-0 flex-1 bg-transparent text-xl text-text placeholder:text-muted focus:outline-none" />
				</div>

				<div class="relative flex items-start gap-3 border-b border-border py-2.5">
					<span class="mt-1 w-6 text-center text-muted">👥</span>
					<div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
						{#each attendees as a (a.mail)}
							<span class="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-xs text-text" title={a.mail}>{a.name}<button class="rounded-full px-1 link-muted" onclick={() => (attendees = attendees.filter((x) => x.mail !== a.mail))}>×</button></span>
						{/each}
						<input value={q} oninput={(e) => onQ(e.currentTarget.value)} onkeydown={qKeys} placeholder={attendees.length ? '' : 'Invite required attendees'} class="min-w-40 flex-1 bg-transparent py-1 text-md text-text placeholder:text-muted focus:outline-none" />
					</div>
					{#if hits.length}
						<div class="absolute top-full left-9 z-10 mt-1 w-80 rounded-md border border-border bg-surface-2 py-1 shadow-lg">
							{#each hits as h, i (h.id)}
								<button class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs {i === active ? 'bg-surface' : ''} hover:bg-surface" onmousedown={(e) => (e.preventDefault(), pick(h))}>
									<span class="flex size-6 items-center justify-center rounded-full bg-accent/30 text-2xs font-semibold">{initials(h.name)}</span>
									<span class="min-w-0 flex-1"><span class="block truncate text-text">{h.name}</span><span class="block truncate text-muted">{h.mail}</span></span>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<div class="flex items-center gap-3 border-b border-border py-2.5">
					<span class="w-6 text-center text-muted">🕒</span>
					<!-- a series' date is its first occurrence; moving it would shift the whole pattern, so only times change -->
					<input type="date" bind:value={date} disabled={edit?.series} title={edit?.series ? 'Change the series dates in Outlook' : undefined} class="rounded-md bg-surface-2 px-2 py-1 text-md text-text focus:outline-none disabled:opacity-60" />
					<input type="time" bind:value={startT} step="900" class="rounded-md bg-surface-2 px-2 py-1 text-md text-text focus:outline-none" />
					<span class="text-muted">–</span>
					<input type="time" bind:value={endT} step="900" class="rounded-md bg-surface-2 px-2 py-1 text-md text-text focus:outline-none" />
					{#if end <= start}<span class="err">end must be after start</span>{/if}
				</div>

				<div class="flex items-center gap-3 border-b border-border py-2.5">
					<span class="flex w-6 justify-center text-muted"><Icon name="pin" class="size-4" /></span>
					<input bind:value={location} placeholder="Add a room or location" class="min-w-0 flex-1 bg-transparent text-md text-text placeholder:text-muted focus:outline-none" />
				</div>

				<div class="flex items-center gap-3 pt-3">
					<span class="flex w-6 justify-center text-muted"><Icon name="video" class="size-4" /></span>
					<!-- Teams on/off is fixed once the meeting exists -->
					<button type="button" role="switch" aria-checked={online} aria-label="Teams meeting" disabled={!!edit} class="relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 {online ? 'bg-accent' : 'bg-border-2'}" onclick={() => (online = !online)}>
						<span class="absolute top-0.5 size-5 rounded-full bg-white transition-all {online ? 'left-[22px]' : 'left-0.5'}"></span>
					</button>
					<span class="text-md text-text">Teams meeting</span>
				</div>
			</div>

			<div class="mt-3 flex min-h-40 flex-1 gap-3 rounded-lg bg-surface p-4">
				<span class="w-6 text-center text-muted">📝</span>
				<textarea bind:value={body} placeholder="Add details for this event" class="min-h-32 flex-1 resize-none bg-transparent text-sm leading-6 text-text placeholder:text-muted focus:outline-none"></textarea>
			</div>
		</div>

		<!-- day preview -->
		<aside class="flex w-72 shrink-0 flex-col border-l border-border">
			<div class="flex h-11 items-center gap-2 border-b border-border px-3 text-body">
				<button class="link-muted" onclick={() => { const d = new Date(start); d.setDate(d.getDate() - 1); date = localInput(d).slice(0, 10); }}>‹</button>
				<span class="flex-1 text-center text-text">{fmtDay(start)}</span>
				<button class="link-muted" onclick={() => { const d = new Date(start); d.setDate(d.getDate() + 1); date = localInput(d).slice(0, 10); }}>›</button>
			</div>
			<div class="flex-1 overflow-y-auto" bind:this={previewEl}>
				<div class="relative ml-12 border-l border-border" style="height: {HOURS.length * H}px">
					{#each HOURS as h (h)}
						<div class="absolute -left-12 w-11 -translate-y-1/2 pr-1 text-right text-2xs text-muted" style="top: {(h - HOURS[0]) * H}px">{hourLabel(h)}</div>
						<div class="absolute right-0 left-0 border-t border-border/60" style="top: {(h - HOURS[0]) * H}px"></div>
					{/each}
					{#each dayEvents as e (e.id)}
						<div class="absolute right-1 left-1 overflow-hidden rounded bg-surface-2 px-1 text-2xs text-muted" style="top: {top(new Date(e.start))}px; height: {hgt(new Date(e.start), new Date(e.end))}px">{e.subject}</div>
					{/each}
					{#if end > start}
						<div class="absolute right-1 left-1 rounded bg-draft px-1.5 text-caption font-medium text-black" style="top: {top(start)}px; height: {hgt(start, end)}px">{clock(start)} – {clock(end)}</div>
					{/if}
				</div>
			</div>
		</aside>
	</div>
</div>
