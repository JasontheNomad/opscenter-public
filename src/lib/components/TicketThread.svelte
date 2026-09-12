<script lang="ts">
	// A HubSpot ticket's conversation: Updates (team notes in HubSpot) and Client Response (portal
	// messages + emails), each with its composer, plus Notes — the client's own vault notes, the same
	// ones the Clients page shows, opened in their own window.
	import { api, post as apiPost, errMsg } from '$lib/api';
	import { contactsAt, type Task, type Activity, type Contact } from '$lib/types';
	import { payload, type Att } from '$lib/attachments';
	import { clientThread, teamNotes } from '$lib/activity';
	import { tick, untrack } from 'svelte';
	import Thread from './Thread.svelte';
	import Icon from './Icon.svelte';
	import { noteWindows } from '$lib/notes/window.svelte';
	import { shortDate } from '$lib/format';
	import CompanyPicker from './CompanyPicker.svelte';
	import TicketComposer from './TicketComposer.svelte';

	let { task, contacts }: { task: Task; contacts: Contact[] } = $props();

	let tab = $state<'notes' | 'client' | 'vault'>('client'); // tickets open on the conversation with the client
	let activity = $state<Activity[]>([]);
	let contact = $state<Contact | null>(null);
	let loading = $state(false);
	let loadError = $state('');
	// A sent reply is read back through HubSpot's email search, which is eventually consistent — for a
	// minute after sending, the thread comes back without it. Hold it locally until the index catches up.
	let pending = $state<Activity[]>([]);
	async function loadActivity(id: number) {
		loading = true;
		loadError = '';
		try {
			const data = await api<{ items: Activity[]; contact: Contact | null }>(`/api/tasks/${id}/activity`);
			if (id === task.id) {
				activity = data.items;
				contact = data.contact;
				pending = pending.filter((p) => !data.items.some((a) => a.kind === p.kind && a.body.trim() === p.body.trim()));
			}
		} catch (e) {
			loadError = errMsg(e);
		} finally {
			loading = false;
		}
	}
	// depend on the id value, not the task object (every local patch creates a new object)
	const taskId = $derived(task.id);
	$effect(() => {
		void loadActivity(taskId);
	});

	// ---- Notes tab: the client's vault notes. Loaded on first open, not with the ticket — most tickets
	// are answered without ever looking at them.
	type VaultNote = { file: string; title: string; excerpt: string; updated_at: string; pinned: boolean };
	let vault = $state<{ client: string | null; notes: VaultNote[] } | null>(null);
	let vaultError = $state('');
	async function loadVault(id: number) {
		vaultError = '';
		try {
			const data = await api<{ client: string | null; notes: VaultNote[] }>(`/api/tasks/${id}/client-notes`);
			if (id === task.id) vault = data;
		} catch (e) {
			vaultError = errMsg(e);
		}
	}
	$effect(() => {
		if (tab !== 'vault') return;
		const id = taskId;
		untrack(() => void loadVault(id));
	});
	// another ticket: its own client's notes
	$effect(() => {
		taskId;
		untrack(() => (vault = null));
	});
	// New note from the ticket: the same vault file the Clients page writes, so it shows up there too.
	// A company with no folder yet gets one (and the link), the way the Clients page makes it.
	let creating = $state(false);
	async function newNote() {
		const title = prompt('Note title');
		if (!title?.trim() || creating) return;
		creating = true;
		vaultError = '';
		try {
			let client = vault?.client;
			if (!client) {
				const made = await apiPost<{ folder: string }>('/api/notes', { client: task.company_name, company_id: task.company_id });
				client = made.folder;
			}
			const { file } = await apiPost<{ file: string }>('/api/notes', { client, title });
			await loadVault(task.id);
			noteWindows.open(client, file);
		} catch (e) {
			vaultError = errMsg(e);
		} finally {
			creating = false;
		}
	}

	async function pinNote(file: string, pinned: boolean) {
		if (!vault?.client) return;
		await apiPost('/api/notes/pin', { client: vault.client, file, pinned });
		await loadVault(task.id);
	}

	const notesList = $derived(teamNotes(activity));
	const clientList = $derived(clientThread([...activity, ...pending], task));

	// compose: team note (Notes tab) or client reply (Client Response tab) -> HubSpot
	type Kind = 'notes' | 'reply';
	let drafts = $state<Record<Kind, string>>({ notes: '', reply: '' });
	let atts = $state<Record<Kind, Att[]>>({ notes: [], reply: [] });
	let sending = $state(false);
	let sendError = $state('');
	async function post(kind: Kind) {
		const text = drafts[kind].trim();
		if ((!text && !atts[kind].length) || sending) return;
		sending = true;
		sendError = '';
		try {
			await apiPost(`/api/tasks/${task.id}/${kind}`, { text, subject: task.title, uploads: atts[kind].map(payload) });
			if (kind === 'reply')
				pending = [
					...pending,
					{ id: `sent-${Date.now()}`, kind: 'email', at: new Date().toISOString(), author: 'Me', subject: task.title, body: text, portal: false, attachments: [] }
				];
			drafts[kind] = '';
			atts[kind] = [];
			await loadActivity(task.id);
			// the local copy carries no attachments, so re-read until the indexed one (with its images)
			// replaces it rather than leaving the reply text alone on screen
			if (kind === 'reply') for (const ms of [3000, 10_000]) setTimeout(() => void loadActivity(task.id), ms);
		} catch (e) {
			sendError = errMsg(e);
		} finally {
			sending = false;
		}
	}

	// "Add note" / "Reply" from elsewhere (card menu, shortcuts): switch tab, focus its box
	let composer: TicketComposer | undefined = $state();
	async function focusBox(e: Event) {
		tab = (e as CustomEvent<'note' | 'reply'>).detail === 'note' ? 'notes' : 'client';
		await tick();
		composer?.focus();
	}
	$effect(() => {
		window.addEventListener('oc:focus', focusBox);
		return () => window.removeEventListener('oc:focus', focusBox);
	});

	// attach contact to ticket (HubSpot association) -> becomes reply "To"
	let pickingContact = $state(false);
	// only contacts at this task's company
	const contactOptions = $derived(contactsAt(contacts, task.company_id));
	async function attachContact(id: string | null) {
		if (!id) return;
		sendError = '';
		try {
			await apiPost(`/api/tasks/${task.id}/contact`, { contact_id: id });
		} catch (e) {
			sendError = errMsg(e);
			return;
		}
		pickingContact = false;
		await loadActivity(task.id);
	}
</script>

{#snippet toRow()}
	<div class="flex flex-wrap items-center gap-x-2 text-caption text-muted">
		<span>To:</span>
		{#if contact?.email && !pickingContact}
			<span class="text-text">{contact.name}</span> &lt;{contact.email}&gt;
			<button type="button" class="text-accent hover:underline" onclick={() => (pickingContact = true)}>change</button>
		{:else if !task.company_id}
			<span class="text-p-urgent">set Company above first</span>
		{:else if contactOptions.length === 0}
			<span class="text-p-urgent">no contacts with email at {task.company_name}</span>
		{:else}
			<CompanyPicker
				companies={contactOptions}
				value={null}
				placeholder="Pick contact at {task.company_name}…"
				onchange={attachContact}
			/>
			{#if pickingContact}<button type="button" class="link-muted" onclick={() => (pickingContact = false)}>cancel</button>{/if}
		{/if}
		<span>· Subject: <span class="text-text">{task.title}</span></span>
	</div>
{/snippet}

<div class="flex flex-1 flex-col">
	<div class="mb-3 flex gap-1 border-b border-border">
		{#each ([['notes', 'Updates'], ['client', 'Client Response'], ['vault', 'Notes']] as const) as [id, label] (id)}
			<button
				class="-mb-px border-b-2 px-3 py-1.5 text-xs {tab === id
					? 'border-accent text-text'
					: 'border-transparent link-muted'}"
				onclick={() => (tab = id)}>{label}</button
			>
		{/each}
		<span class="flex-1"></span>
		{#if loading}<span class="text-caption text-muted">loading…</span>{/if}
		{#if loadError}<span class="err" title={loadError}>load error</span>{/if}
	</div>

	{#if tab === 'vault'}
		{#if vaultError}<p class="err mb-2 text-xs">{vaultError}</p>{/if}
		{#if !vault}
			<p class="text-xs text-muted">Loading…</p>
		{:else}
			<div class="mb-1 flex items-center gap-2">
				<span class="field-label flex-1">{vault.client ?? task.company_name ?? 'This ticket'} · client notes</span>
				{#if task.company_id}
					<button class="btn border-accent/40 px-2 py-0.5 text-sm leading-none text-accent hover:border-accent hover:bg-accent/10" title="New note" aria-label="New note" disabled={creating} onclick={newNote}>+</button>
				{/if}
			</div>
			{#if !vault.client}
				<p class="text-xs text-muted">No client folder yet — + makes one for {task.company_name ?? 'this company'} and links it.</p>
			{/if}
			<div class="flex flex-col">
				{#each vault.notes as n (n.file)}
					<div class="group relative rounded-md hover:bg-surface-2/60">
						<button
							class="block w-full px-2 py-2 pr-7 text-left"
							title="Open in its own window"
							onclick={() => noteWindows.open(vault?.client ?? '', n.file)}
						>
							<div class="truncate text-body text-text">{n.title}</div>
							<div class="truncate text-caption text-muted">{n.excerpt || '—'}</div>
							<div class="text-2xs text-muted">{shortDate(n.updated_at)}</div>
						</button>
						<button
							class="absolute top-1.5 right-1 rounded p-1 hover:text-text {n.pinned ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
							title={n.pinned ? 'Unpin' : 'Pin to top'}
							aria-label={n.pinned ? 'Unpin note' : 'Pin note to top'}
							onclick={() => pinNote(n.file, !n.pinned)}
						><Icon name="pin" class="size-3.5" /></button>
					</div>
				{:else}
					<p class="px-2 py-2 text-xs text-muted">No notes for this client yet.</p>
				{/each}
			</div>
		{/if}
	{:else if tab === 'notes'}
		<div class="field-label">Team notes (HubSpot)</div>
		<TicketComposer
			bind:this={composer}
			bind:draft={drafts.notes}
			bind:atts={atts.notes}
			bind:error={sendError}
			busy={sending}
			placeholder="Add team note… visible to your team in HubSpot, not to the client. ↵ post · ⇧↵ newline · drop or paste images"
			label="Add note"
			onsend={() => void post('notes')}
		/>
		<Thread items={notesList} empty="No team notes yet." />
	{:else}
		<!-- reads like the portal: the client's request first, the conversation after, reply at the end -->
		<Thread items={clientList} empty="No client messages yet." />
		<!-- pinned to the bottom of the panel's scroll area: a long conversation otherwise pushes the
		     reply box off screen, and replying meant scrolling past every message to reach it -->
		<div class="sticky -bottom-4 -mb-4 border-t border-border bg-surface pt-3 pb-6">
			<TicketComposer
				bind:this={composer}
				bind:draft={drafts.reply}
				bind:atts={atts.reply}
				bind:error={sendError}
				busy={sending}
				tall
				blocked={!contact?.email}
				placeholder="Reply to client… logged to HubSpot as email on this ticket. ↵ send · ⇧↵ newline · drop or paste images"
				label="Send to client"
				onsend={() => void post('reply')}
				header={toRow}
			/>
		</div>
	{/if}
</div>
