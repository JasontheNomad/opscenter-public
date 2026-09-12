<script lang="ts">
	import { api, post } from '$lib/api';
	import { goto, beforeNavigate, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import NotePane from '$lib/components/NotePane.svelte';
	import { noteWindows } from '$lib/notes/window.svelte';
	import Card from '$lib/components/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Thread from '$lib/components/Thread.svelte';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { COLUMNS } from '$lib/columns';
	import type { Activity } from '$lib/types';
	import { textStyle } from '$lib/textSize';
	import { shortDate as when } from '$lib/format';
	import { NoteSession } from '$lib/noteSession.svelte';

	let { data } = $props();

	const enc = encodeURIComponent;
	const colName = (id: string) => COLUMNS.find((c) => c.id === id)?.name ?? id;
	const base = $derived(data.client ? `/clients/${enc(data.client.name)}` : '/clients');
	// carry the back-link through tab / note navigation
	const keep = $derived(data.back ? `&from=${enc(data.back.href)}&fromTitle=${enc(data.back.title)}` : '');
	const noteHref = (file: string) => `${base}?tab=notes&n=${enc(file)}${keep}`;

	const TABS = $derived(
		data.client?.company_id
			? [['notes', 'Notes'], ['tickets', 'Tickets'], ['contacts', 'Contacts'], ['history', 'History']]
			: [['notes', 'Notes']]
	);

	// --- editor
	// One session per opened note, made only when a different note opens. A root reload (theme push, text
	// size) hands the page a new `data` carrying this same note's load-time body; starting over on that put
	// the stale text back in the editor and autosave wrote it over the file.
	const noteKey = $derived(data.client && data.note ? `${data.client.name}/${data.note.file}` : '');
	const note = $derived.by(() => {
		noteKey;
		return untrack(() => (data.client && data.note ? new NoteSession(data.client.name, data.note.file, data.note.body, data.note.mtime) : null));
	});
	// leaving (another note, another page): save what's pending, even if the page goes away mid-request
	beforeNavigate(() => void note?.save({ keepalive: true }));

	// double-click a row: the note gets its own window, as a call does. The click that precedes it has
	// already selected the note here, so a refused popup leaves it open in the page anyway.
	function popOut(e: MouseEvent, file: string) {
		e.preventDefault();
		noteWindows.open(data.client?.name ?? '', file);
	}

	// pinned notes sort to the top of the list, here and in a ticket's Notes tab (the server sorts)
	async function togglePin(file: string, pinned: boolean) {
		await post('/api/notes/pin', { client: data.client?.name, file, pinned });
		await invalidateAll();
	}

	async function newNote() {
		const title = prompt('Note title');
		if (!title || !data.client) return;
		let folder = data.client.name;
		// a company with tickets but no folder yet: make the folder (cleaned name, linked to the company)
		// first, then use the name the server actually gave it — the company name can hold / : ? etc.
		if (data.client.virtual && data.client.company_id)
			({ folder } = await post<{ folder: string }>('/api/notes', { client: folder, company_id: data.client.company_id }));
		const { file } = await post<{ file: string }>('/api/notes', { client: folder, title });
		await goto(`/clients/${enc(folder)}?tab=notes&n=${enc(file)}${keep}`, { invalidateAll: true });
	}
	async function newClient() {
		const name = prompt('Client folder name');
		if (!name) return;
		// navigate to the folder the server actually made: createClient() strips \ / : * ? " < > |
		// and trims, so the typed name can differ and would 404
		const { folder } = await post<{ folder: string }>('/api/notes', { client: name });
		await goto(`/clients/${enc(folder)}`, { invalidateAll: true });
	}

	async function del(file?: string) {
		if (!data.client) return;
		const what = file ? `note "${file.replace(/\.md$/, '')}"` : `client "${data.client.name}" and all its notes`;
		if (!confirm(`Move ${what} to .trash?`)) return;
		await api('/api/notes', 'DELETE', { client: data.client.name, file });
		await goto(file ? `${base}?tab=notes` : '/clients', { invalidateAll: true });
	}

	// --- history (lazy, per client)
	let history = $state<Activity[] & { ticket?: string; task_id?: number }[]>([]);
	let historyFor = $state<string | null>(null);
	let historyLoading = $state(false);
	$effect(() => {
		const id = data.client?.company_id ?? null;
		if (data.tab !== 'history' || !id || historyFor === id) return;
		historyLoading = true;
		api<typeof history>(`/api/clients/${id}/history`)
			.then((d) => ((history = d), (historyFor = id)))
			.catch(() => {}) // leaves the list as it was; the next visit to the tab retries
			.finally(() => (historyLoading = false));
	});

	let q = $state('');
	const clients = $derived(data.clients.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())));

	const openTicket = (id: number) => goto(`/task/${id}`);

	// paste a HubSpot company URL (…/record/0-2/<id>) or bare id, or pick from search
	let linkInput = $state('');
	function linkFromInput() {
		const m = linkInput.match(/record\/0-2\/(\d+)/) ?? linkInput.match(/^\s*(\d{6,})\s*$/);
		if (m) void linkCompany(m[1]);
	}
	async function linkCompany(id: string | null) {
		if (!id || !data.client) return;
		await post('/api/clients/link', { folder: data.client.name, company_id: id });
		await goto(base, { invalidateAll: true });
	}

	function keys(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') (e.preventDefault(), void note?.save());
	}
</script>

<svelte:window onkeydown={keys} />

<div class="flex min-w-0 flex-1" style={textStyle(data.textSize, 'clients')}>
	<!-- clients -->
	<aside class="flex w-56 shrink-0 flex-col border-r border-border">
		<div class="pane-header gap-2 px-3">
			<input bind:value={q} placeholder="Filter clients" class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs placeholder:text-muted focus-accent" />
			<button class="text-accent hover:opacity-80" title="New client folder" aria-label="New client folder" onclick={newClient}>+</button>
		</div>
		<div class="flex-1 overflow-y-auto p-2">
			{#each clients as c (c.name)}
				<a href="/clients/{enc(c.name)}" class="flex items-center gap-2 rounded-md px-2 py-1.5 text-body {data.client?.name === c.name ? 'nav-active' : 'nav-idle'}">
					<span class="flex-1 truncate">{c.name}</span>
					{#if c.open}<span class="rounded-full bg-accent/20 px-1.5 text-2xs text-accent">{c.open}</span>{/if}
					<span class="text-2xs">{c.notes || ''}</span>
				</a>
			{/each}
		</div>
	</aside>

	{#if !data.client}
		<div class="flex flex-1 items-center justify-center text-xs text-muted">Select a client.</div>
	{:else}
		<section class="flex min-w-0 flex-1 flex-col">
			<header class="pane-header gap-4 px-4">
				{#if data.back}
					<a href={data.back.href} class="btn shrink-0 px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text" title="Back to {data.back.title}">← Back</a>
				{/if}
				<!-- the name gives way first in a narrow window (truncates); tabs and buttons stay whole -->
				<span class="min-w-0 leading-tight" title={data.client.company_name && data.client.company_name !== data.client.name ? `${data.client.name} — ${data.client.company_name}` : data.client.name}>
					<span class="block truncate text-sm font-semibold">{data.client.name}</span>
					{#if data.client.company_name && data.client.company_name !== data.client.name}<span class="block truncate text-caption text-muted">{data.client.company_name}</span>{/if}
				</span>
				<nav class="flex shrink-0 gap-1">
					{#each TABS as [id, label] (id)}
						<a href="{base}?tab={id}{keep}" class="rounded-md px-2.5 py-1 text-xs whitespace-nowrap {data.tab === id ? 'bg-surface-2 text-text' : 'link-muted'}">{label}</a>
					{/each}
				</nav>
				<span class="flex-1"></span>
				{#if !data.client.company_id}
					<div class="flex items-center gap-2 text-caption text-muted">
						<span>Link HubSpot company:</span>
						<div class="w-56"><CompanyPicker companies={data.companies} value={null} placeholder="Search by name…" onchange={linkCompany} /></div>
						<span>or</span>
						<form onsubmit={(e) => (e.preventDefault(), linkFromInput())}>
							<input bind:value={linkInput} placeholder="paste HubSpot URL / id ↵" class="w-52 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs placeholder:text-muted focus-accent" />
						</form>
					</div>
				{/if}
				{#if data.tab === 'notes'}
					<button class="btn shrink-0 border-accent/40 px-2 py-0.5 text-sm leading-none text-accent hover:border-accent hover:bg-accent/10" title="New note" aria-label="New note" onclick={newNote}>+</button>
				{/if}
				<button class="shrink-0 rounded-md border border-p-urgent/60 px-2 py-1 text-xs whitespace-nowrap text-p-urgent hover:bg-p-urgent hover:text-white" title="Move client folder to .trash" onclick={() => del()}>Delete client</button>
			</header>

			{#if data.tab === 'tickets'}
				<div class="flex-1 overflow-y-auto p-6">
					<div class="mx-auto flex max-w-2xl flex-col gap-1.5">
						{#each data.tickets as t (t.id)}
							<div class="flex items-center gap-3">
								<div class="min-w-0 flex-1"><Card task={t} onselect={openTicket} /></div>
								<span class="w-28 shrink-0 text-caption text-muted">{colName(t.status)}</span>
							</div>
						{:else}
							<p class="text-xs text-muted">No tickets on the board for this client.</p>
						{/each}
					</div>
				</div>

			{:else if data.tab === 'contacts'}
				<div class="flex-1 overflow-y-auto p-6">
					<div class="mx-auto max-w-2xl divide-y divide-border rounded-md border border-border bg-surface">
						{#each data.contacts as c (c.id)}
							<div class="flex items-center gap-3 px-3 py-2 text-xs">
								<span class="flex-1 text-text">{c.name}</span>
								{#if c.email}<a href="mailto:{c.email}" class="text-accent hover:underline">{c.email}</a>{/if}
							</div>
						{:else}
							<p class="p-3 text-xs text-muted">No contacts synced for this company.</p>
						{/each}
					</div>
				</div>

			{:else if data.tab === 'history'}
				<div class="flex-1 overflow-y-auto p-6">
					<div class="mx-auto max-w-2xl">
						{#if historyLoading}<p class="text-xs text-muted">Loading…</p>
						{:else}
							<div class="flex flex-col gap-3">
								{#each history as a (a.kind + a.id)}
									<div>
										<button class="mb-1 text-caption text-accent hover:underline" onclick={() => a.task_id && openTicket(a.task_id)}>{a.ticket}</button>
										<Thread items={[a]} empty="" />
									</div>
								{:else}
									<p class="text-xs text-muted">No messages yet.</p>
								{/each}
							</div>
						{/if}
					</div>
				</div>

			{:else}
				<div class="flex min-h-0 flex-1">
					<aside class="flex w-72 shrink-0 flex-col border-r border-border">
						<div class="flex-1 overflow-y-auto p-2">
							{#each data.notes as n (n.file)}
								<div class="group relative rounded-md {data.note?.file === n.file ? 'bg-surface-2' : 'hover:bg-surface-2/60'}">
									<a
										href={noteHref(n.file)}
										title="Double-click to open in its own window"
										ondblclick={(e) => popOut(e, n.file)}
										class="block px-2 py-2 pr-7 select-none"
									>
										<div class="truncate text-body text-text">{n.title}</div>
										<div class="truncate text-caption text-muted">{n.excerpt || '—'}</div>
										<div class="text-2xs text-muted">{when(n.updated_at)}</div>
									</a>
									<button
										class="absolute top-1.5 right-1 rounded p-1 hover:text-text {n.pinned ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
										title={n.pinned ? 'Unpin' : 'Pin to top'}
										aria-label={n.pinned ? 'Unpin note' : 'Pin note to top'}
										onclick={() => togglePin(n.file, !n.pinned)}
									><Icon name="pin" class="size-3.5" /></button>
								</div>
							{:else}
								<p class="p-2 text-xs text-muted">No notes yet.</p>
							{/each}
						</div>
					</aside>
					<div class="flex min-w-0 flex-1 flex-col" style={textStyle(data.textSize, 'notes')}>
						{#if note}
							<!-- one pane per note: its own undo history, so Cmd-Z can't pull another note's text in -->
							{#key noteKey}
								<NotePane {note} client={data.client?.name ?? ''} ondelete={del} />
							{/key}
						{:else}
							<div class="flex flex-1 items-center justify-center text-xs text-muted">Select or create a note.</div>
						{/if}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>
