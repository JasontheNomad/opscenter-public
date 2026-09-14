<script lang="ts">
	import { api, post } from '$lib/api';
	import { goto, beforeNavigate, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import NotePane from '$lib/components/NotePane.svelte';
	import { noteWindows } from '$lib/notes/window.svelte';
	import { trail } from '$lib/notes/trail.svelte';
	import { CLIENTS, clientOf, leaf, vaultHref } from '$lib/notes/vault';
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
	const base = $derived(vaultHref(data.folder?.path));
	// carry the back-link through tab / note navigation
	const keep = $derived(data.back ? `&from=${enc(data.back.href)}&fromTitle=${enc(data.back.title)}` : '');
	const noteHref = (file: string) => `${base}?tab=notes&n=${enc(file)}${keep}`;
	const isClient = $derived(!!data.folder && clientOf(data.folder.path) !== null);

	const TABS = $derived(
		data.folder?.company_id
			? [['notes', 'Notes'], ['tickets', 'Tickets'], ['contacts', 'Contacts'], ['history', 'History']]
			: [['notes', 'Notes']]
	);

	// --- editor
	// One session per opened note, made only when a different note opens. A root reload (theme push, text
	// size) hands the page a new `data` carrying this same note's load-time body; starting over on that put
	// the stale text back in the editor and autosave wrote it over the file.
	const noteKey = $derived(data.folder && data.note ? `${data.folder.path}/${data.note.file}` : '');
	const note = $derived.by(() => {
		noteKey;
		return untrack(() => (data.folder && data.note ? new NoteSession(data.folder.path, data.note.file, data.note.body, data.note.mtime) : null));
	});
	// leaving (another note, another page): save what's pending, even if the page goes away mid-request
	beforeNavigate(() => void note?.save({ keepalive: true }));

	// ← → over the notes opened here (lib/notes/trail.svelte.ts); a wiki-link into another folder's note counts too.
	// untrack: this must follow the page's note only — reading the trail here made a step re-run it before the
	// navigation landed, re-recording the note being left and cutting off everything ahead of it
	$effect(() => {
		const stop = data.folder && data.note ? { client: data.folder.path, file: data.note.file } : null;
		if (stop) untrack(() => trail.visit(stop));
	});
	function stepNote(d: -1 | 1) {
		const s = trail.step(d);
		if (s) void goto(`${vaultHref(s.client)}?tab=notes&n=${enc(s.file)}${keep}`);
	}

	// double-click a row: the note gets its own window, as a call does. The click that precedes it has
	// already selected the note here, so a refused popup leaves it open in the page anyway.
	function popOut(e: MouseEvent, file: string) {
		e.preventDefault();
		noteWindows.open(data.folder?.path ?? '', file);
	}

	// pinned notes sort to the top of the list, here and in a ticket's Notes tab (the server sorts)
	async function togglePin(file: string, pinned: boolean) {
		await post('/api/notes/pin', { client: data.folder?.path, file, pinned });
		await invalidateAll();
	}

	async function newNote() {
		const title = prompt('Note title');
		if (!title || !data.folder) return;
		const { file } = await post<{ file: string }>('/api/notes', { client: data.folder.path, title });
		await goto(noteHref(file), { invalidateAll: true });
	}
	// parent '' = the vault's top level
	async function newFolder(parent: string) {
		menu = null;
		const name = prompt(parent ? `New subfolder in ${parent}` : 'New top-level folder');
		if (!name) return;
		// navigate to the folder the server actually made: createFolder() strips \ / : * ? " < > |
		// and trims, so the typed name can differ and would 404
		const { folder } = await post<{ folder: string }>('/api/notes', { parent, name });
		if (parent) setOpen(parent, true); // so the new folder shows under it
		await goto(vaultHref(folder), { invalidateAll: true });
	}

	// "new folder" menu: from the + in the header (at: null), or a right-click on a folder (at: the cursor)
	let menu = $state<{ folder: string | null; at: { x: number; y: number } | null } | null>(null);
	function closeMenu(e: Event) {
		if (menu && !(e.target as HTMLElement).closest('[data-folder-menu]')) menu = null;
	}
	function rowMenu(e: MouseEvent, folder: string) {
		e.preventDefault();
		menu = { folder, at: { x: e.clientX, y: e.clientY } };
	}

	async function del(file?: string) {
		if (!data.folder) return;
		const path = data.folder.path;
		const what = file ? `note "${file.replace(/\.md$/, '')}"` : `folder "${path}" and everything in it`;
		if (!confirm(`Move ${what} to .trash?`)) return;
		await api('/api/notes', 'DELETE', { client: path, file });
		await goto(file ? `${base}?tab=notes` : vaultHref(path.slice(0, Math.max(0, path.lastIndexOf('/')))), { invalidateAll: true });
	}

	// --- history (lazy, per client)
	let history = $state<Activity[] & { ticket?: string; task_id?: number }[]>([]);
	let historyFor = $state<string | null>(null);
	let historyLoading = $state(false);
	$effect(() => {
		const id = data.folder?.company_id ?? null;
		if (data.tab !== 'history' || !id || historyFor === id) return;
		historyLoading = true;
		api<typeof history>(`/api/clients/${id}/history`)
			.then((d) => ((history = d), (historyFor = id)))
			.catch(() => {}) // leaves the list as it was; the next visit to the tab retries
			.finally(() => (historyLoading = false));
	});

	// --- folder tree: a folder shows when every folder above it is expanded. Folders start collapsed, except
	// those on the way to the open folder; an arrow click decides from then on, remembered per browser.
	const EXPANDED = 'vaultExpanded';
	let expanded = $state<Record<string, boolean>>({});
	// read after hydration: the server has no localStorage, and a tree built from it would mismatch
	$effect(() => {
		try {
			expanded = JSON.parse(localStorage.getItem(EXPANDED) ?? '{}');
		} catch {}
	});
	const current = $derived(data.folder?.path ?? '');
	const isOpen = (p: string) => expanded[p] ?? current.startsWith(`${p}/`);
	function setOpen(p: string, open: boolean) {
		expanded[p] = open;
		try {
			localStorage.setItem(EXPANDED, JSON.stringify(expanded));
		} catch {}
	}
	const ancestors = (p: string) => {
		const parts = p.split('/');
		return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
	};
	const tree = $derived(
		data.folders
			.map((f, i) => ({ ...f, kids: (data.folders[i + 1]?.depth ?? -1) > f.depth }))
			.filter((f) => ancestors(f.path).every(isOpen))
	);

	let q = $state('');
	// typing filters folders by name, flat, wherever they sit in the tree
	const matches = $derived(q.trim() ? data.folders.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase())) : null);

	// the same box also searches inside every note once it holds 3+ chars (debounced; a stale reply is dropped)
	type Hit = { client: string; file: string; title: string; line: number; text: string };
	let hits = $state<Hit[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const query = q.trim();
		clearTimeout(searchTimer);
		if (query.length < 3) return void (hits = []);
		searching = true;
		searchTimer = setTimeout(async () => {
			const got = await api<{ hits: Hit[] }>(`/api/notes/search?q=${enc(query)}`).catch(() => ({ hits: [] }));
			if (q.trim() === query) (hits = got.hits), (searching = false);
		}, 250);
	});
	// results grouped by folder -> note, in vault order
	const hitGroups = $derived.by(() => {
		const byNote = new Map<string, { client: string; file: string; title: string; lines: Hit[] }>();
		for (const h of hits) {
			const key = `${h.client}/${h.file}`;
			if (!byNote.has(key)) byNote.set(key, { client: h.client, file: h.file, title: h.title, lines: [] });
			byNote.get(key)!.lines.push(h);
		}
		return [...byNote.values()];
	});
	// [before, match, after] for the first query word, so the match can be bolded without {@html}
	function hilite(text: string): [string, string, string] {
		const w = q.trim().split(/\s+/)[0] ?? '';
		const i = w ? text.toLowerCase().indexOf(w.toLowerCase()) : -1;
		return i < 0 ? [text, '', ''] : [text.slice(0, i), text.slice(i, i + w.length), text.slice(i + w.length)];
	}

	const openTicket = (id: number) => goto(`/task/${id}`);

	// paste a HubSpot company URL (…/record/0-2/<id>) or bare id, or pick from search
	let linkInput = $state('');
	function linkFromInput() {
		const m = linkInput.match(/record\/0-2\/(\d+)/) ?? linkInput.match(/^\s*(\d{6,})\s*$/);
		if (m) void linkCompany(m[1]);
	}
	async function linkCompany(id: string | null) {
		if (!id || !data.folder) return;
		await post('/api/clients/link', { folder: data.folder.path, company_id: id });
		await goto(base, { invalidateAll: true });
	}

	function keys(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') (e.preventDefault(), void note?.save());
		if (e.key === 'Escape' && menu) menu = null;
	}
</script>

<svelte:window onkeydown={keys} onpointerdowncapture={closeMenu} />

{#snippet folderMenu(folder: string | null, style = '')}
	<div class="menu w-56" role="menu" data-folder-menu {style}>
		<button class="menu-item menu-idle" role="menuitem" onclick={() => newFolder('')}><Icon name="folder" class="size-3.5" /> New folder</button>
		{#if folder}
			<button class="menu-item menu-idle" role="menuitem" title="New subfolder in {folder}" onclick={() => newFolder(folder)}><Icon name="plus" class="size-3.5" /> <span class="truncate">New subfolder in {leaf(folder)}</span></button>
		{/if}
	</div>
{/snippet}

{#snippet folderRow(f: (typeof data.folders)[number], indent: number, kids: boolean, sub: string)}
	<div class="flex items-center rounded-md {current === f.path ? 'nav-active' : 'nav-idle'}" style="padding-left: {indent * 12}px">
		{#if kids}
			<button class="flex size-6 shrink-0 items-center justify-center rounded hover:text-text" aria-label={isOpen(f.path) ? `Collapse ${f.name}` : `Expand ${f.name}`} aria-expanded={isOpen(f.path)} onclick={() => setOpen(f.path, !isOpen(f.path))}>
				<Icon name="chevron-right" class="size-4 transition-transform {isOpen(f.path) ? 'rotate-90' : ''}" />
			</button>
		{:else}
			<span class="size-6 shrink-0"></span>
		{/if}
		<a href={vaultHref(f.path)} title={f.path} oncontextmenu={(e) => rowMenu(e, f.path)} class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-body">
			{#if f.depth === 0}<Icon name={kids && isOpen(f.path) ? 'folder-open' : 'folder'} class="size-4" />{/if}
			<span class="min-w-0 flex-1">
				<span class="block truncate">{f.name}</span>
				{#if sub}<span class="block truncate text-2xs text-muted">{sub}</span>{/if}
			</span>
			{#if f.open}<span class="rounded-full bg-accent/20 px-1.5 text-2xs text-accent">{f.open}</span>{/if}
			<span class="text-2xs">{f.notes || ''}</span>
		</a>
	</div>
{/snippet}

<div class="flex min-w-0 flex-1" style={textStyle(data.textSize, 'clients')}>
	<!-- folders -->
	<aside class="flex w-56 shrink-0 flex-col border-r border-border">
		<div class="pane-header gap-2 px-3">
			<input bind:value={q} placeholder="Filter folders / search notes" class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs placeholder:text-muted focus-accent" />
			<div class="relative" data-folder-menu>
				<button class="text-accent hover:opacity-80" title="New folder" aria-label="New folder" aria-haspopup="menu" aria-expanded={!!menu && !menu.at} onclick={() => (menu = menu && !menu.at ? null : { folder: data.folder?.path ?? null, at: null })}>+</button>
				{#if menu && !menu.at}{@render folderMenu(menu.folder)}{/if}
			</div>
		</div>
		<div class="flex-1 overflow-y-auto p-2">
			{#if matches}
				{#each matches as f (f.path)}
					{@render folderRow(f, 0, false, f.path.slice(0, Math.max(0, f.path.lastIndexOf('/'))))}
				{/each}
			{:else}
				{#each tree as f (f.path)}
					{@render folderRow(f, f.depth, f.kids, '')}
				{/each}
			{/if}
			{#if q.trim().length >= 3}
				<div class="mt-2 border-t border-border pt-2">
					<div class="px-2 pb-1 text-2xs tracking-wide text-muted uppercase">In notes{searching ? '…' : hitGroups.length ? '' : ': none'}</div>
					{#each hitGroups as g (g.client + '/' + g.file)}
						{@const href = `${vaultHref(g.client)}?tab=notes&n=${enc(g.file)}`}
						<div class="rounded-md px-2 py-1.5 nav-idle">
							<a {href} class="block">
								<div class="truncate text-2xs">{g.client}</div>
								<div class="truncate text-body text-text">{g.title}</div>
							</a>
							{#each g.lines as l (l.line)}
								{@const [pre, m, post] = hilite(l.text)}
								<a href="{href}&line={l.line}" class="block truncate text-caption hover:text-text">{pre}<b class="text-accent">{m}</b>{post}</a>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</aside>

	{#if !data.folder}
		<div class="flex flex-1 items-center justify-center text-xs text-muted">Select a folder.</div>
	{:else}
		<section class="flex min-w-0 flex-1 flex-col">
			<header class="pane-header gap-4 px-4">
				{#if data.back}
					<a href={data.back.href} class="btn shrink-0 px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text" title="Back to {data.back.title}">← Back</a>
				{/if}
				<!-- the name gives way first in a narrow window (truncates); tabs and buttons stay whole -->
				<span class="min-w-0 leading-tight" title={data.folder.company_name && data.folder.company_name !== data.folder.name ? `${data.folder.path} — ${data.folder.company_name}` : data.folder.path}>
					<span class="block truncate text-sm font-semibold">{data.folder.name}</span>
					{#if data.folder.company_name && data.folder.company_name !== data.folder.name}<span class="block truncate text-caption text-muted">{data.folder.company_name}</span>{/if}
				</span>
				<nav class="flex shrink-0 gap-1">
					{#each TABS as [id, label] (id)}
						<a href="{base}?tab={id}{keep}" class="rounded-md px-2.5 py-1 text-xs whitespace-nowrap {data.tab === id ? 'bg-surface-2 text-text' : 'link-muted'}">{label}</a>
					{/each}
				</nav>
				<span class="flex-1"></span>
				{#if isClient && !data.folder.company_id}
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
					<button class="btn shrink-0 px-2 py-0.5 text-sm leading-none text-muted hover:border-accent hover:text-text disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted" title="Previous note" aria-label="Previous note" disabled={!trail.canBack} onclick={() => stepNote(-1)}>←</button>
					<button class="btn shrink-0 px-2 py-0.5 text-sm leading-none text-muted hover:border-accent hover:text-text disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted" title="Next note" aria-label="Next note" disabled={!trail.canForward} onclick={() => stepNote(1)}>→</button>
					<button class="btn shrink-0 border-accent/40 px-2 py-0.5 text-sm leading-none text-accent hover:border-accent hover:bg-accent/10" title="New note" aria-label="New note" onclick={newNote}>+</button>
				{/if}
				{#if data.folder.path !== CLIENTS}
					<button class="shrink-0 rounded-md border border-p-urgent/60 px-2 py-1 text-xs whitespace-nowrap text-p-urgent hover:bg-p-urgent hover:text-white" title="Move folder to .trash" onclick={() => del()}>Delete folder</button>
				{/if}
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
								<NotePane {note} line={data.line} client={data.folder?.path ?? ''} ondelete={del} onopen={(c, f) => goto(`${vaultHref(c)}?tab=notes&n=${enc(f)}${keep}`)} />
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

<!-- right-click menu, at the cursor -->
{#if menu?.at}
	{@render folderMenu(menu.folder, `position: fixed; left: ${menu.at.x}px; top: ${menu.at.y}px; right: auto; margin-top: 0`)}
{/if}
