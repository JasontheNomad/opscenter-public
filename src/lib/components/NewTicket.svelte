<script lang="ts">
	import { post, errMsg } from '$lib/api';
	import { PROJECT_PIPELINE_LABEL, SUPPORT_PIPELINE_LABEL } from '$lib/views';
	// Draft a HubSpot ticket in a side drawer (same shape as Panel). Nothing is sent until "Create ticket".
	import { contactsAt, type Task, type Company, type Contact } from '$lib/types';
	import CompanyPicker from './CompanyPicker.svelte';
	import PriorityPicker from './PriorityPicker.svelte';
	import { persistedWidth } from '$lib/resizable.svelte';

	let {
		view,
		companies,
		contacts,
		onclose,
		oncreated
	}: {
		view: 'support' | 'projects';
		companies: Company[];
		contacts: Contact[];
		onclose: () => void;
		oncreated: (task: Task) => void;
	} = $props();


	let title = $state('');
	let priority = $state(0);
	let companyId = $state<string | null>(null);
	let contactId = $state<string | null>(null);
	let description = $state('');
	let creating = $state(false);
	let err = $state('');

	// contacts with email at the chosen company
	const contactOptions = $derived(contactsAt(contacts, companyId));


	async function create() {
		const t = title.trim();
		if (!t || creating) return;
		creating = true;
		err = '';
		try {
			oncreated(await post<Task>('/api/tickets', { title: t, view, company_id: companyId, contact_id: contactId, priority, description }));
		} catch (e) {
			err = errMsg(e);
		} finally {
			creating = false;
		}
	}

	const width = persistedWidth('panelWidth', 768, 320);
</script>

<aside data-panel class="relative flex shrink-0 flex-col border-l border-border bg-surface" style="width: {width.value}px">
	<header class="pane-header gap-2 px-4">
		<span class="text-xs text-muted">New ticket · {view === 'projects' ? PROJECT_PIPELINE_LABEL : SUPPORT_PIPELINE_LABEL}</span>
		<span class="flex-1"></span>
		<button class="ml-2 link-muted" onclick={onclose} aria-label="Close">✕</button>
	</header>

	<form class="flex flex-1 flex-col gap-5 overflow-y-auto p-4" onsubmit={(e) => (e.preventDefault(), create())}>
		<input
			{@attach (el) => el.focus()}
			bind:value={title}
			placeholder="Ticket subject"
			class="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm font-medium placeholder:text-muted focus-accent"
		/>

		<div>
			<div class="field-label">Priority</div>
			<PriorityPicker value={priority} onchange={(p) => (priority = p)} />
		</div>

		<div>
			<div class="field-label">Company (optional)</div>
			<CompanyPicker {companies} value={companyId} onchange={(id) => { companyId = id; contactId = null; }} />
		</div>

		{#if companyId}
			<div>
				<div class="field-label">Contact (optional)</div>
				{#if contactOptions.length}
					<CompanyPicker companies={contactOptions} value={contactId} placeholder="Pick contact…" onchange={(id) => (contactId = id)} />
				{:else}
					<span class="text-xs text-muted">no contacts with email at this company</span>
				{/if}
			</div>
		{/if}

		<div class="flex flex-1 flex-col">
			<div class="field-label">Description (HubSpot ticket description)</div>
			<textarea
				bind:value={description}
				class="min-h-40 flex-1 resize-none rounded-md border border-border bg-surface-2 p-2 text-xs leading-5 focus-accent"
				placeholder="What needs doing. Visible to your team in HubSpot."
			></textarea>
		</div>

		<div class="flex items-center gap-3">
			<button class="btn-primary px-3 py-1.5 text-xs" disabled={creating || !title.trim()}>
				{creating ? 'Creating…' : 'Create ticket'}
			</button>
			<button type="button" class="text-xs link-muted" onclick={onclose}>Cancel</button>
			{#if err}<span class="truncate err" title={err}>{err}</span>{/if}
		</div>
	</form>
</aside>
