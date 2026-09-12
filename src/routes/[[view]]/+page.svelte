<script lang="ts">
	import { nowIso } from '$lib/dates';
	import { invalidateAll, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { COLUMNS, type Status } from '$lib/columns';
	import { isUnseen, type Task } from '$lib/types';
	import { Board, type Cols } from '$lib/board.svelte';
	import Column from '$lib/components/Column.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import { post } from '$lib/api';
	import NewTicket from '$lib/components/NewTicket.svelte';
	import { textStyle } from '$lib/textSize';
	import { directory } from '$lib/directory.svelte';
	import { clock } from '$lib/format';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	const board = new Board(data.tasks);
	$effect(() => board.reset(data.tasks));
	// picker lists, in the background: ready by the time a card or the new-ticket drawer opens
	$effect(() => void directory.load());

	// opening a HubSpot card clears its "changed" bubble
	$effect(() => {
		const t = board.selected;
		if (t && isUnseen(t)) {
			board.patchLocal(t.id, { hs_seen_at: nowIso() });
			post(`/api/tasks/${t.id}/seen`).catch(() => {}); // best effort: the bubble is already gone locally
		}
	});
	// deep link: /support?task=123 opens the panel (see /task/[id] redirect)
	$effect(() => {
		const id = Number(page.url.searchParams.get('task'));
		if (id) board.selectedId = id;
	});
	// company -> notes folder (server-computed map)
	const notesFolder = $derived(board.selected?.company_id ? (data.folders[board.selected.company_id] ?? null) : null);


	// --- search
	let q = $state('');
	let searchInput: HTMLInputElement;
	const filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return board.cols;
		const b = {} as Cols;
		for (const c of COLUMNS)
			b[c.id] = board.cols[c.id].filter((t) =>
				// search what the card shows: notes on manual tasks, the HubSpot description on tickets
				`${t.title} ${t.source === 'manual' ? t.notes : (t.description ?? '')} ${t.hs_stage_label ?? ''}`.toLowerCase().includes(needle)
			);
		return b;
	});
	const searching = $derived(q.trim().length > 0);

	// --- create
	let title = $state('');
	let input: HTMLInputElement | undefined = $state();
	async function create() {
		const t = title.trim();
		if (!t) return;
		title = '';
		await board.create(t);
	}

	// Support / Projects: "+" opens a drawer to draft a HubSpot ticket in that pipeline
	const ticketView = $derived(data.view.id === 'support' || data.view.id === 'projects');
	let drafting = $state(false);
	async function created(task: Task & { warning?: string }) {
		drafting = false;
		await invalidateAll();
		board.selectedId = task.id;
		if (task.warning) flash(task.warning);
	}
	const openDraft = () => ((board.selectedId = null), (drafting = true));

	// --- notice
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout>;
	function flash(msg: string) {
		if (!msg) return;
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), 6000);
	}

	// --- drag / move (notice from HubSpot push shows in the header)
	const finalize = async (status: Status, items: Task[]) => flash(await board.finalize(status, items));
	const moveSelected = async (status: Status) => board.selected && flash(await board.move(board.selected, status));
	const markDone = async (id: number) => { const t = board.find(id); if (t) flash(await board.move(t, 'done')); };

	// --- sync
	let syncing = $state(false);
	let syncError = $state('');
	async function sync() {
		if (syncing) return;
		syncing = true;
		syncError = '';
		try {
			const res = await fetch('/api/sync', { method: 'POST' });
			if (!res.ok) syncError = (await res.json()).error ?? `sync failed (${res.status})`;
			await invalidateAll();
		} finally {
			syncing = false;
		}
	}
	// the server's own 90 s sync, failing quietly in the background until now (root layout status)
	const bgSync = $derived(page.data.teams?.hubspot?.sync);
	// a ticket with no conversation thread cannot be replied to — the client never sees it
	const bgSeed = $derived(page.data.teams?.hubspot?.seed);
	// server syncs HubSpot every 90s; just refresh the board view
	$effect(() => {
		const id = setInterval(() => invalidateAll(), 90_000);
		return () => clearInterval(id);
	});

	// --- keyboard
	const visibleColumns = $derived(data.view.hideDone ? data.view.columns.filter((c) => c.id !== 'done') : data.view.columns);
	// visual order of cards for j/k
	const ordered = $derived(visibleColumns.flatMap((c) => filtered[c.id]));
	function step(dir: 1 | -1) {
		if (ordered.length === 0) return;
		const i = ordered.findIndex((t) => t.id === board.selectedId);
		const next = i === -1 ? (dir === 1 ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, i + dir));
		board.selectedId = ordered[next].id;
		document.querySelector(`[data-task="${board.selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
	}
	let pendingG = $state(false);
	let gTimer: ReturnType<typeof setTimeout>;
	let showHelp = $state(false);
	const GOTO: Record<string, string> = { p: '/projects', s: '/support', c: '/clients', m: '/teams', a: '/calendar' };

	function hotkeys(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
		if (e.key === 'Escape') {
			if (typing) (e.target as HTMLElement).blur();
			else if (showHelp) showHelp = false;
			else if (board.selectedId !== null) board.selectedId = null;
			else q = '';
			return;
		}
		if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
		if (pendingG) {
			pendingG = false;
			clearTimeout(gTimer);
			if (GOTO[e.key]) (e.preventDefault(), void goto(GOTO[e.key]));
			return;
		}
		switch (e.key) {
			case 'j': case 'ArrowDown': e.preventDefault(); step(1); break;
			case 'k': case 'ArrowUp': e.preventDefault(); step(-1); break;
			case 'Enter': if (board.selectedId === null) step(1); break;
			case 'c':
				if (input) (e.preventDefault(), input.focus());
				else if (ticketView) (e.preventDefault(), openDraft());
				break;
			case '/': e.preventDefault(); searchInput.focus(); break;
			case 'n': case 'r':
				if (board.selected && board.selected.source !== 'manual') (e.preventDefault(), window.dispatchEvent(new CustomEvent('oc:focus', { detail: e.key === 'n' ? 'note' : 'reply' })));
				break;
			case 'g': pendingG = true; gTimer = setTimeout(() => (pendingG = false), 800); break;
			case '?': showHelp = !showHelp; break;
			default:
				{
					const col = /^[1-9]$/.test(e.key) ? data.view.columns[Number(e.key) - 1] : undefined;
					if (col && board.selected) (e.preventDefault(), void moveSelected(col.id));
				}
		}
	}
	// click anywhere outside the panel (and not on a card, or on a floating overlay) closes it
	function clickAway(e: PointerEvent) {
		if (board.selectedId === null) return;
		const el = e.target as HTMLElement;
		if (el.closest('[data-panel], [data-task], [data-overlay]')) return;
		board.selectedId = null;
	}

	const HELP: [string, string][] = $derived([
		['j / k', 'next / previous card'], ['Enter', 'select first card'], ['Esc', 'close panel / clear'],
		[`1–${data.view.columns.length}`, `move card to column (${data.view.columns[0].name} … Done)`], ['n', 'write team note'], ['r', 'reply to client'],
		['c', 'new task'], ['/', 'search'], ['g p/s/c/m/a', 'go Projects / Support / Clients / Teams / cAlendar'], ['?', 'this help']
	]);
</script>

<svelte:window onkeydown={hotkeys} onpointerdown={clickAway} />

<!-- text size for this board (Settings → Text size) -->
<div class="flex min-w-0 flex-1" style={textStyle(data.textSize, data.view.id)}>
	<div class="flex min-w-0 flex-1 flex-col">
		<header class="pane-header gap-3 px-4">
			<span class="leading-tight">
				<span class="block text-sm font-semibold tracking-tight">{data.view.name}</span>
				<span class="block text-caption text-muted">{data.view.blurb}</span>
			</span>
			<form class="flex-1 pl-2" onsubmit={(e) => (e.preventDefault(), create())}>
				{#if data.view.manual}
					<input
						bind:this={input}
						bind:value={title}
						placeholder="New task…  (C)"
						class="w-full max-w-md rounded-md border border-border bg-surface px-3 py-1.5 text-text placeholder:text-muted focus-accent"
					/>
				{:else if ticketView}
					<button
						type="button"
						class="btn px-3 py-1.5 text-muted hover:border-border-2 hover:text-text"
						title="New ticket  (C)"
						onclick={openDraft}>+ New ticket</button
					>
				{/if}
			</form>
			<input
				bind:this={searchInput}
				bind:value={q}
				placeholder="Search  (/)"
				class="w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-text placeholder:text-muted focus-accent"
			/>
			{#if notice}<span class="max-w-xs truncate text-xs text-muted" title={notice}>{notice}</span>{/if}
			{#if syncError}<span class="text-xs text-p-urgent" title={syncError}>sync error</span>
			{:else if bgSync?.failingSince}<span class="text-xs text-p-urgent" title={bgSync.error ?? ''}>HubSpot sync failing since {clock(bgSync.failingSince)}</span>
			{:else if bgSeed?.stuck}<span class="text-xs text-p-urgent" title={bgSeed.error ?? 'no conversation thread — a reply will not reach the client'}>{bgSeed.stuck} ticket{bgSeed.stuck > 1 ? 's' : ''} can't reach the client</span>{/if}
			<button
				class="btn px-3 py-1.5 text-muted hover:border-border-2 hover:text-text"
				disabled={syncing}
				onclick={sync}>{syncing ? 'Syncing…' : 'Sync'}</button
			>
		</header>
		<main class="flex flex-1 gap-3 overflow-x-auto p-4">
			{#each visibleColumns as col (col.id)}
				<Column
					name={col.name}
					items={filtered[col.id]}
					selectedId={board.selectedId}
					dragDisabled={searching}
					onconsider={(items) => board.consider(col.id, items)}
					onfinalize={(items) => finalize(col.id, items)}
					onselect={(id) => board.toggle(id)}
				/>
			{/each}
		</main>
	</div>
	{#if showHelp}
		<button data-overlay class="fixed inset-0 z-40 bg-black/50" onclick={() => (showHelp = false)} aria-label="close"></button>
		<div data-overlay class="fixed top-1/2 left-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-4 shadow-xl">
			<div class="mb-3 text-sm font-semibold">Keyboard</div>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
				{#each HELP as [k, v] (k)}
					<dt><kbd class="rounded border border-border bg-surface-2 px-1.5 py-px font-mono text-caption">{k}</kbd></dt>
					<dd class="text-muted">{v}</dd>
				{/each}
			</dl>
		</div>
	{/if}
	{#if drafting && ticketView}
		<NewTicket view={data.view.id as 'support' | 'projects'} companies={directory.companies} contacts={directory.contacts} onclose={() => (drafting = false)} oncreated={created} />
	{:else if board.selected}
		{#key board.selected.id}
			<Panel task={board.selected} {notesFolder} companies={directory.companies} contacts={directory.contacts} onclose={() => (board.selectedId = null)} onpatch={async (id, p) => flash(await board.patch(id, p))} ondelete={async (id) => flash(await board.remove(id))} ondone={markDone} />
		{/key}
	{/if}
</div>
