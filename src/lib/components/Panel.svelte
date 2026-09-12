<script lang="ts">
	import { post as apiPost } from '$lib/api';
	import type { Task, Company, Contact } from '$lib/types';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import CompanyPicker from './CompanyPicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import Checklist from './Checklist.svelte';
	import TicketThread from './TicketThread.svelte';
	import type { TaskPatch } from '$lib/server/tasks';
	import { descriptionText } from '$lib/activity';
	import { shortDateTime as fmt } from '$lib/format';
	import { persistedWidth, resizable } from '$lib/resizable.svelte';
	import { escapeHtml, linkUrls } from '$lib/html';
	import { textStyle } from '$lib/textSize';

	let {
		task,
		notesFolder,
		companies,
		contacts,
		onclose,
		onpatch,
		ondelete,
		ondone
	}: {
		task: Task;
		notesFolder: string | null;
		companies: Company[];
		contacts: Contact[];
		onclose: () => void;
		onpatch: (id: number, patch: TaskPatch) => void;
		ondelete: (id: number) => void;
		ondone: (id: number) => void;
	} = $props();

	const hs = $derived(task.source !== 'manual');

	// create vault folder named after company + link it
	async function createFolder() {
		if (!task.company_id || !task.company_name) return;
		await apiPost('/api/notes', { client: task.company_name, company_id: task.company_id });
		await invalidateAll();
	}

	// The notes box is this panel's own copy (the panel is re-created per card): bound to task.notes, a board
	// refresh landing mid-typing put the older server text back and the next keystroke saved it.
	// svelte-ignore state_referenced_locally
	let notesDraft = $state(task.notes);
	let notesTimer: ReturnType<typeof setTimeout>;
	function notes(v: string) {
		notesDraft = v;
		const id = task.id; // capture: the panel may show another card by the time the timer fires
		clearTimeout(notesTimer);
		notesTimer = setTimeout(() => onpatch(id, { notes: v }), 500);
	}

	// A portal ticket's description is the client's opening message and shows in its thread instead
	const description = $derived.by(() => {
		const text = task.submitted_via ? '' : descriptionText(task.description);
		return text && linkUrls(escapeHtml(text));
	});

	// --- resizable width (drag left edge), remembered per browser
	const width = persistedWidth('panelWidth', 768, 320);
</script>

<aside data-panel class="relative flex shrink-0 flex-col border-l border-border bg-surface" style="width: {width.value}px; {textStyle(page.data.textSize, 'panel')}">
	<!-- resize handle -->
	<div
		class="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize hover:bg-accent/40"
		{@attach resizable(width, 'left')}
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize panel"
	></div>
	<header class="pane-header gap-2 px-4">
		<span class="text-xs text-muted">
			{#if hs}{task.hs_pipeline_label} · {task.hs_stage_label}{:else}Manual task{/if}
		</span>
		<span class="flex-1"></span>
		{#if hs}
			<a href={task.hs_url} target="_blank" rel="noreferrer" class="text-xs text-accent hover:underline"
				>Open in HubSpot ↗</a
			>
		{/if}
		<button class="ml-2 link-muted" onclick={onclose} aria-label="Close">✕</button>
	</header>

	<div class="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
		{#if hs}
			<h2 class="text-sm leading-6 font-medium">{task.title}</h2>
			{#if description}
				<div>
					<div class="field-label">Description</div>
					<p class="max-h-60 overflow-y-auto rounded-md border border-border bg-surface-2 px-3 py-2 text-xs leading-5 whitespace-pre-wrap [&_a]:break-all [&_a]:text-accent [&_a]:underline">{@html description}</p>
				</div>
			{/if}
		{:else}
			<input
				class="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-border focus-accent"
				value={task.title}
				onchange={(e) => onpatch(task.id, { title: e.currentTarget.value })}
			/>
		{/if}

		<div>
			<div class="field-label">Priority{hs ? ' (syncs to HubSpot)' : ''}</div>
			<PriorityPicker value={task.priority} onchange={(p) => onpatch(task.id, { priority: p })} />
		</div>

		<div>
			<div class="field-label">Company</div>
			<CompanyPicker
				{companies}
				value={task.company_id}
				onchange={(id) => onpatch(task.id, { company_id: id })}
			/>
		</div>

		<!-- client notes and due date side by side; Mark as done at the far right -->
		<div class="flex flex-wrap items-end gap-x-6 gap-y-3">
			{#if task.company_id}
				<div>
					<div class="field-label">Client notes</div>
					{#if notesFolder}
						<a href="/clients/{encodeURIComponent(notesFolder)}?from={encodeURIComponent(`${page.url.pathname}?task=${task.id}`)}&fromTitle={encodeURIComponent(task.title)}" class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-text hover:border-accent">
							📁 {notesFolder} →
						</a>
					{:else}
						<button class="rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text" onclick={createFolder}>
							No folder for {task.company_name} — create
						</button>
					{/if}
				</div>
			{/if}
			<div>
				<div class="field-label">Due</div>
				<input
					type="date"
					class="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs focus-accent"
					value={task.due_date ?? ''}
					onchange={(e) => onpatch(task.id, { due_date: e.currentTarget.value || null })}
				/>
			</div>
			<span class="flex-1"></span>
			{#if task.status !== 'done'}
				<button
					class="rounded-md border border-p-urgent/60 px-2.5 py-1 text-xs text-p-urgent hover:bg-p-urgent hover:text-white"
					title={hs ? 'Moves to Done and closes the ticket in HubSpot' : 'Moves to Done'}
					onclick={() => ondone(task.id)}>Mark as done</button
				>
			{/if}
		</div>

		<Checklist checklist={task.checklist} onsave={(list) => onpatch(task.id, { checklist: JSON.stringify(list) })} />

		{#if hs}
			<TicketThread {task} {contacts} />
		{:else}
			<div class="flex flex-1 flex-col">
				<div class="field-label">Notes</div>
				<textarea
					class="min-h-40 flex-1 resize-none rounded-md border border-border bg-surface-2 p-2 text-xs leading-5 focus-accent"
					value={notesDraft}
					oninput={(e) => notes(e.currentTarget.value)}
					placeholder="Notes stay local, never sent to HubSpot"
				></textarea>
			</div>
		{/if}

		<div class="flex items-center justify-between text-caption text-muted">
			<span title="created {fmt(task.created_at)}">updated {fmt(task.updated_at)}</span>
			{#if !hs}
				<button class="text-muted hover:text-p-urgent" onclick={() => ondelete(task.id)}>Delete</button>
			{/if}
		</div>
	</div>
</aside>
