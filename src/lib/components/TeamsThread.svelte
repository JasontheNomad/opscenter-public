<script lang="ts">
	import { nowIso } from '$lib/dates';
	import { post, errMsg } from '$lib/api';
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { textToHtml, escapeHtml, linkUrls } from '$lib/html';
	import { cleanHtml } from '$lib/sanitize';
	import { readFiles, pastedFiles, payload, isImage, tooBig, type Att } from '$lib/attachments';
	import AttachmentStrip from './AttachmentStrip.svelte';
	import { pickFiles } from '$lib/composer';
	import { timeOrDate as when } from '$lib/format';
	import Icon from './Icon.svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ChatMessage, Quote } from '$lib/server/teams';
	import Avatar from './Avatar.svelte';
	import { openTeamsWindow, callUrl } from '$lib/teamsLinks';
	import { calls } from '$lib/calls/engine.svelte';
	import SharedPanel from './SharedPanel.svelte';
	import { meetNow as startMeetNow } from '$lib/calls/join';

	let view = $state<'chat' | 'shared'>('chat');


	let {
		title,
		subtitle = '',
		webUrl,
		messages,
		error = null,
		target,
		callEmails = [],
		callPeople = []
	}: {
		title: string;
		subtitle?: string;
		webUrl: string;
		messages: ChatMessage[];
		error?: string | null;
		target: { chat: string } | { team: string; channel: string };
		callEmails?: string[]; // other members' emails (chats) — the msteams: deep link addresses by email
		callPeople?: { id: string; name: string }[]; // same people by Entra object id — ACS calls address by id
	} = $props();

	// channel threads: Teams-style right pane (root post + replies + "Reply in thread")
	let threadId = $state<string | null>(null);
	let threadDraft = $state('');
	let extraReplies = $state<Record<string, ChatMessage[]>>({}); // replies posted here before the next refresh
	let threadBox: HTMLTextAreaElement | undefined = $state();
	const threadRoot = $derived(threadId ? (messages.find((m) => m.id === threadId) ?? null) : null);
	const threadOf = (m: ChatMessage) => [...(m.replies ?? []), ...(extraReplies[m.id] ?? [])];
	async function openThread(m: ChatMessage) { threadId = m.id; threadDraft = ''; await tick(); threadBox?.focus(); }
	async function sendReply() {
		if (!('team' in target) || !threadRoot) return;
		const m = threadRoot;
		const text = threadDraft.trim();
		if (!text) return;
		threadDraft = '';
		const local: ChatMessage = { id: 'pending-' + Date.now(), at: nowIso(), from: 'You', fromId: null, html: linkUrls(textToHtml(text)), text, me: true, files: [], reactions: [] };
		extraReplies[m.id] = [...(extraReplies[m.id] ?? []), local];
		await post('/api/teams/replies', { team: target.team, channel: target.channel, message: m.id, text }).catch((e) => ((sendError = errMsg(e)), (threadDraft = text)));
		await invalidateAll();
		extraReplies[m.id] = [];
	}
	// ?thread=<id> deep link opens that thread
	$effect(() => {
		const id = page.url.searchParams.get('thread');
		if (id) { threadId = id; setTimeout(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center' }), 100); }
	});
	let threadScroll: HTMLDivElement | undefined = $state();
	$effect(() => {
		const n = threadRoot ? threadOf(threadRoot).length : 0; // re-run when replies arrive
		if (n >= 0) requestAnimationFrame(() => threadScroll?.scrollTo({ top: threadScroll.scrollHeight }));
	});

	// Calls run one of two ways, chosen by CALLS_ENGINE (see docs/acs-calling-sow.md §8):
	//   acs      — placed in-app through the ACS engine, ringing as Jason from OpsCenter
	//   deeplink — handed to the Teams desktop app, which is what shipped before
	// Every path falls back to the deep link, so a broken engine degrades to the old behaviour
	// instead of leaving a dead button.
	let callMenu = $state(false);
	const isChannel = $derived('channel' in target);
	async function startCall(video: boolean) {
		callMenu = false;
		try {
			if (callPeople.length && (await calls.inApp())) {
				// check mic/camera before ringing anyone, rather than discovering a dead mic mid-call
				const who = callPeople.map((p) => p.name).filter(Boolean).join(', ') || title;
				calls.prepare(`Call ${who}`, (o) =>
					// the chat id only means something for a group call — see the SOW's accepted limits
					calls.startCall(callPeople.map((p) => p.id), {
						video: o.video,
						threadId: 'chat' in target ? target.chat : undefined
					}),
					video
				);
				return;
			}
		} catch (e) {
			sendError = errMsg(e);
		}
		calls.noteHandoff();
		if (callEmails?.length) openTeamsWindow(callUrl(callEmails, video));
	}
	async function meetNow() {
		callMenu = false;
		await startMeetNow().catch((e) => (sendError = errMsg(e)));
	}

	const dayLabel = (iso: string) => {
		const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
		if (d.toDateString() === now.toDateString()) return 'Today';
		if (d.toDateString() === y.toDateString()) return 'Yesterday';
		return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	};
	const grouped = $derived.by(() => {
		const out: { from: string; fromId: string | null; me: boolean; at: string; day: string | null; items: ChatMessage[] }[] = [];
		let lastDay = '';
		for (const m of all) {
			const day = new Date(m.at).toDateString();
			const newDay = day !== lastDay;
			lastDay = day;
			const last = out[out.length - 1];
			if (!newDay && last && last.from === m.from && new Date(m.at).getTime() - new Date(last.items[last.items.length - 1].at).getTime() < 5 * 60_000) last.items.push(m);
			else out.push({ from: m.from, fromId: m.fromId, me: m.me, at: m.at, day: newDay ? dayLabel(m.at) : null, items: [m] });
		}
		return out;
	});

	let draft = $state('');
	let sendError = $state('');
	let quote = $state<Quote | null>(null);
	let box: HTMLTextAreaElement | undefined = $state();
	function startQuote(m: ChatMessage) {
		quote = { id: m.id, from: m.me ? 'You' : m.from, fromId: m.fromId, preview: m.text.slice(0, 200) };
		box?.focus();
	}
	// attachments (drag-drop / paste): images go inline, other files upload to OneDrive
	let atts = $state<Att[]>([]);
	let dragOver = $state(false);
	async function addFiles(list: FileList | File[] | null | undefined) {
		const { atts: read, rejected } = await readFiles(list);
		if (rejected.length) sendError = tooBig(rejected);
		atts = [...atts, ...read];
	}
	function onDrop(e: DragEvent) { e.preventDefault(); dragOver = false; void addFiles(e.dataTransfer?.files); box?.focus(); }
	function onPaste(e: ClipboardEvent) {
		const files = pastedFiles(e);
		if (files.length) { e.preventDefault(); void addFiles(files); }
	}

	// optimistic send: show the message immediately, post in the background
	let pending = $state<ChatMessage[]>([]);
	async function send() {
		const text = draft.trim();
		const ups = atts;
		if (!text && !ups.length) return;
		const q = quote;
		draft = '';
		quote = null;
		atts = [];
		sendError = '';
		const imgs = ups.filter(isImage).map((a) => `<img src="${a.url}" alt="${escapeHtml(a.name)}" data-zoom>`).join('');
		const local: ChatMessage = {
			id: 'pending-' + Date.now(), at: nowIso(), from: 'You', fromId: null,
			html: (q ? `<blockquote class="quote"><span class="who">${escapeHtml(q.from)}</span>${escapeHtml(q.preview)}</blockquote>` : '') + linkUrls(textToHtml(text)) + (imgs ? (text ? '<br>' : '') + imgs : ''),
			text, me: true, files: ups.filter((a) => !isImage(a)).map((a) => ({ name: a.name, url: '#' })), reactions: []
		};
		pending = [...pending, local];
		try {
			await post('/api/teams/send', { ...target, text, quote: q, uploads: ups.map(payload) });
			await invalidateAll();
		} catch (e) {
			sendError = errMsg(e);
			draft = text; // give it back
			quote = q;
			atts = ups;
		} finally {
			pending = pending.filter((m) => m.id !== local.id);
		}
	}
	// merged list: server messages + not-yet-confirmed ones
	const all = $derived([...messages, ...pending]);
	// reactions
	const QUICK = ['👍', '❤️', '😆', '😮'];
	const MORE = ['😂', '🙏', '🔥', '🎉', '👀', '✅', '😢', '😠', '🤔', '💯', '👏', '🚀'];
	let pickerFor = $state<string | null>(null);
	// click outside / Esc closes the picker
	function closeMenus(e: Event) {
		if (callMenu && !(e.target as HTMLElement).closest('[data-call-menu]')) callMenu = false;
		if (menuFor) {
			if (e instanceof KeyboardEvent) { if (e.key === 'Escape') menuFor = null; }
			else if (!(e.target as HTMLElement).closest('[data-msg-menu]')) menuFor = null;
		}
		if (!pickerFor) return;
		if (e instanceof KeyboardEvent) { if (e.key === 'Escape') pickerFor = null; return; }
		if (!(e.target as HTMLElement).closest('[data-picker]')) pickerFor = null;
	}
	// ---- edit / delete your own message
	// The edit box holds the message's plain text plus a chip per attachment or inline image; removing a
	// chip drops that piece from the rebuilt body (the server needs the full keep-list, not the dropped
	// one, because Graph replaces the whole body).
	let editId = $state<string | null>(null);
	let editText = $state('');
	let dropped = $state<string[]>([]);
	let editBox: HTMLTextAreaElement | undefined = $state();
	let menuFor = $state<string | null>(null);
	async function startEdit(m: ChatMessage) {
		menuFor = null;
		editId = m.id;
		editText = m.text;
		dropped = [];
		await tick();
		editBox?.focus();
		editBox?.setSelectionRange(editText.length, editText.length);
	}
	function cancelEdit() { editId = null; editText = ''; dropped = []; }
	const toggleDrop = (key: string) => (dropped = dropped.includes(key) ? dropped.filter((k) => k !== key) : [...dropped, key]);
	async function saveEdit(m: ChatMessage) {
		const text = editText.trim();
		const parts = m.parts ?? [];
		const keep = dropped.length ? parts.filter((p) => !dropped.includes(p.key)).map((p) => p.key) : null;
		if (!text && !(keep ?? parts).length) return; // nothing left — delete it instead
		cancelEdit();
		await post('/api/teams/edit', { ...target, message: m.id, text, keep }).catch((e) => (sendError = errMsg(e)));
		await invalidateAll();
	}
	async function removeMessage(m: ChatMessage) {
		menuFor = null;
		if (!confirm('Delete this message? Teams keeps an Undo for a short while.')) return;
		await post('/api/teams/delete', { ...target, message: m.id }).catch((e) => (sendError = errMsg(e)));
		await invalidateAll();
	}

	async function react(m: ChatMessage, emoji: string) {
		pickerFor = null;
		const mine = m.reactions.find((r) => r.emoji === emoji)?.mine ?? false;
		await post('/api/teams/react', { ...target, message: m.id, emoji, on: !mine }).catch((e) => (sendError = errMsg(e)));
		await invalidateAll();
	}

	// auto-scroll only on first load or when a new message lands while already near the bottom
	let scroller: HTMLDivElement | undefined = $state();
	let lastId = '';
	$effect(() => {
		const id = all[all.length - 1]?.id ?? '';
		if (id === lastId) return;
		const first = lastId === '';
		const mine = id.startsWith('pending-');
		lastId = id;
		const nearBottom = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
		if (first || nearBottom || mine) requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
	});
</script>

<svelte:window onpointerdowncapture={closeMenus} onkeydowncapture={closeMenus} />

<section class="flex min-w-0 flex-1">
<div class="flex min-w-0 flex-1 flex-col">
	<header class="pane-header gap-3 px-4">
		<span class="truncate text-sm font-semibold">{title}</span>
		{#if subtitle}<span class="text-caption text-muted">{subtitle}</span>{/if}
		<nav class="ml-3 flex gap-1">
			{#each ([['chat', 'Chat'], ['shared', 'Shared']] as const) as [id, label] (id)}
				<button class="rounded-md px-2.5 py-1 text-xs {view === id ? 'bg-surface-2 text-text' : 'link-muted'}" onclick={() => (view = id)}>{label}</button>
			{/each}
		</nav>
		<span class="flex-1"></span>
		{#if isChannel || callEmails?.length}
			<div class="relative flex items-center" data-call-menu>
				<button class="rounded-l-md border border-border px-2.5 py-1 text-sm hover:border-accent hover:text-text" title={isChannel ? 'Meet now in this channel' : 'Audio call'} onclick={() => (isChannel ? meetNow() : startCall(false))}><Icon name="phone" class="size-4" /></button>
				<button class="rounded-r-md border border-l-0 border-border px-1.5 py-1 text-xs text-muted hover:border-accent hover:text-text" title="More" onclick={() => (callMenu = !callMenu)}>▾</button>
				{#if callMenu}
					<div class="menu w-44 text-xs">
						{#if isChannel}
							<button class="menu-item menu-idle" onclick={meetNow}><Icon name="video" class="mr-1.5 inline size-3.5" />Meet now</button>
						{:else}
							<button class="menu-item menu-idle" onclick={() => startCall(false)}><Icon name="phone" class="mr-1.5 inline size-3.5" />Audio call</button>
							<button class="menu-item menu-idle" onclick={() => startCall(true)}><Icon name="video" class="mr-1.5 inline size-3.5" />Video call</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		<a href={webUrl} target="_blank" rel="noreferrer" class="ml-2 text-caption text-accent hover:underline">Open in Teams ↗</a>
	</header>
	{#if view === 'shared'}
		<SharedPanel {target} />
	{:else}
	<div class="flex-1 overflow-y-auto px-5 py-4" bind:this={scroller}>
		{#if error}
			<div class="mx-auto max-w-md rounded-md border border-border bg-surface p-4 text-xs">
				<p class="mb-2 font-medium text-text">Can't read this channel yet</p>
				<p class="text-muted">{error.includes('403') ? 'Reading channel messages needs an admin to approve ChannelMessage.Read.All for the OpsCenter app. Sending still works.' : error}</p>
			</div>
		{/if}
		<div class="flex flex-col gap-5">
			{#each grouped as g (g.items[0].id)}
				{#if g.day}<div class="my-1 text-center text-caption text-muted">{g.day}</div>{/if}
				<div class="flex gap-2.5 {g.me ? 'flex-row-reverse' : ''}">
					{#if !g.me}<div class="mt-5"><Avatar id={g.fromId} name={g.from} size={32} /></div>{/if}
					<div class="flex min-w-0 flex-col gap-3 {g.me ? 'items-end' : 'items-start'}" style="max-width: min(80%, 720px)">
						<div class="flex items-baseline gap-2 px-1">
							{#if !g.me}<span class="text-xs text-muted">{g.from}</span>{/if}
							<span class="text-caption text-muted">{when(g.at)}</span>
						</div>
						{#each g.items as m (m.id)}
							{@const replies = isChannel ? threadOf(m) : []}
							<div class="group relative {g.me ? 'self-end' : ''}">
								{#if editId === m.id}
									<!-- edit in place: the message's own text and attachments, nothing removed unless you remove it -->
									<div class="min-w-0 rounded-lg border border-accent bg-surface-2 p-2" style="width: min(80vw, 640px)">
										<textarea
											bind:this={editBox}
											bind:value={editText}
											rows="4"
											class="w-full resize-none rounded-md border border-border bg-surface px-3 pt-2 pb-6 text-body leading-6 focus-accent"
											onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void saveEdit(m)); if (e.key === 'Escape') cancelEdit(); }}
										></textarea>
										{#if (m.parts ?? []).length}
											<div class="mt-2 flex flex-wrap gap-2">
												{#each m.parts ?? [] as p (p.key)}
													{@const off = dropped.includes(p.key)}
													<span class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-caption {off ? 'text-muted line-through opacity-60' : 'text-text'}">
														{#if p.kind === 'image' && p.url}<img src={p.url} alt="" class="size-6 rounded object-cover" />
														{:else}<Icon name={p.kind === 'quote' ? 'quote' : 'paperclip'} class="size-3 shrink-0" />{/if}
														<span class="truncate">{p.name}</span>
														<button type="button" class="link-muted shrink-0" title={off ? 'Keep' : 'Remove'} onclick={() => toggleDrop(p.key)}><Icon name={off ? 'plus' : 'x'} class="size-3" /></button>
													</span>
												{/each}
											</div>
										{/if}
										<div class="mt-2 flex items-center justify-end gap-1">
											<span class="mr-auto text-caption text-muted">↵ save · ⇧↵ newline · Esc cancel</span>
											<button type="button" class="rounded px-2 py-1 link-muted" title="Cancel" onclick={cancelEdit}><Icon name="x" class="size-4" /></button>
											<button type="button" class="rounded px-2 py-1 text-accent hover:bg-surface" title="Save" onclick={() => saveEdit(m)}><Icon name="check" class="size-4" /></button>
										</div>
									</div>
								{:else}
								<div class="min-w-0 max-w-full rounded-lg px-3 py-1.5 {g.me ? 'bg-accent/25' : m.mentionsMe ? 'bg-surface-2 ring-1 ring-p-high/60' : 'bg-surface-2'}">
									<div class="teams-msg text-body leading-6 text-text">{@html cleanHtml(m.html)}</div>
									{#if m.files.length}
										<div class="mt-1 flex flex-wrap gap-2">
											{#each m.files as f (f.url)}<a href={f.url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-caption hover:border-accent"><Icon name="paperclip" class="size-3" />{f.name}</a>{/each}
										</div>
									{/if}
									{#if m.edited}<div class="mt-0.5 text-caption text-muted">Edited</div>{/if}
								</div>
								{/if}
								{#if replies.length}
									<button id="msg-{m.id}" class="mt-1 ml-1 flex items-center gap-1.5 text-caption text-accent hover:underline" onclick={() => openThread(m)}>
										<span class="flex -space-x-1">{#each replies.slice(-3) as r (r.id)}<Avatar id={r.fromId} name={r.from} size={16} />{/each}</span>
										{replies.length} {replies.length === 1 ? 'reply' : 'replies'} · last {when(replies.at(-1)!.at)}
									</button>
								{:else if isChannel}<span id="msg-{m.id}"></span>{/if}
								<!-- hover toolbar -->
								{#if editId !== m.id}
								<div class="absolute -top-3.5 {g.me ? 'right-2' : 'left-2'} z-10 hidden items-center gap-0.5 rounded-md border border-border bg-surface px-1 py-0.5 shadow-md group-hover:flex {pickerFor === m.id || menuFor === m.id ? '!flex' : ''}">
									{#each QUICK as e (e)}<button class="rounded px-1 text-sm hover:bg-surface-2" onclick={() => react(m, e)}>{e}</button>{/each}
									<button data-picker class="rounded px-1 text-xs text-muted hover:bg-surface-2 hover:text-text" title="More reactions" onclick={() => (pickerFor = pickerFor === m.id ? null : m.id)}>＋</button>
									<span class="mx-0.5 h-4 w-px bg-border"></span>
									{#if isChannel}<button class="rounded px-1 text-xs text-accent hover:bg-surface-2" title="Reply in thread" onclick={() => openThread(m)}><Icon name="message" class="size-3.5" /></button>{/if}
									<button class="rounded px-1 text-xs text-accent hover:bg-surface-2" title="Reply with quote" onclick={() => startQuote(m)}><Icon name="quote" class="size-3.5" /></button>
									{#if m.me && !m.id.startsWith('pending-')}
										<button class="rounded px-1 text-xs text-muted hover:bg-surface-2 hover:text-text" title="Edit" onclick={() => startEdit(m)}><Icon name="pencil" class="size-3.5" /></button>
										<div class="relative" data-msg-menu>
											<button class="rounded px-1 text-xs text-muted hover:bg-surface-2 hover:text-text" title="More options" onclick={() => (menuFor = menuFor === m.id ? null : m.id)}><Icon name="dots" class="size-3.5" /></button>
											{#if menuFor === m.id}
												<div class="menu w-40 text-xs">
													<button class="menu-item menu-idle" onclick={() => (menuFor = null, startQuote(m))}><Icon name="quote" class="size-3.5" />Reply with quote</button>
													<button class="menu-item menu-idle" onclick={() => startEdit(m)}><Icon name="pencil" class="size-3.5" />Edit</button>
													<button class="menu-item text-alert hover:bg-surface-2" onclick={() => removeMessage(m)}><Icon name="trash" class="size-3.5" />Delete</button>
												</div>
											{/if}
										</div>
									{/if}
								</div>
								{/if}
								{#if pickerFor === m.id}
									<div data-picker class="absolute top-4 {g.me ? 'right-2' : 'left-2'} z-20 grid grid-cols-6 gap-0.5 rounded-md border border-border bg-surface p-1 shadow-lg">
										{#each MORE as e (e)}<button class="rounded px-1 text-base hover:bg-surface-2" onclick={() => react(m, e)}>{e}</button>{/each}
									</div>
								{/if}
								{#if m.reactions.length}
									<div class="mt-0.5 flex flex-wrap gap-1 {g.me ? 'justify-end' : ''}">
										{#each m.reactions as r (r.emoji)}
											<button class="rounded-full border px-1.5 py-px text-caption {r.mine ? 'border-accent bg-accent/15' : 'border-border bg-surface'}" onclick={() => react(m, r.emoji)}>{r.emoji} {r.count}</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
	<form class="flex shrink-0 flex-col gap-2 border-t p-3 {dragOver ? 'border-accent bg-accent/5' : 'border-border'}" onsubmit={(e) => (e.preventDefault(), send())}
		ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)} ondrop={onDrop}>
		<AttachmentStrip {atts} onremove={(i) => (atts = atts.filter((_, j) => j !== i))} />
		{#if quote}
			<div class="flex items-start gap-2 rounded-md border-l-2 border-accent bg-surface-2 px-3 py-1.5 text-xs">
				<div class="min-w-0 flex-1"><div class="text-caption text-muted">{quote.from}</div><div class="truncate text-text">{quote.preview}</div></div>
				<button type="button" class="link-muted" onclick={() => (quote = null)}><Icon name="x" class="size-3.5" /></button>
			</div>
		{/if}
		<div class="flex gap-2">
		<textarea
			bind:this={box}
			bind:value={draft}
			rows="2"
			placeholder="Message… ↵ send · ⇧↵ newline · drop or paste images"
			class="min-w-0 flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 pt-2 pb-6 text-body focus-accent"
			onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void send()); if (e.key === 'Escape') quote = null; }}
			onpaste={onPaste}
		></textarea>
		<label class="flex cursor-pointer items-center rounded-md border border-border px-2 link-muted" title="Attach"><input type="file" multiple class="hidden" onchange={pickFiles(addFiles)} /><Icon name="paperclip" class="size-4" /></label>
		<button class="btn-primary px-4 text-sm" disabled={!draft.trim() && !atts.length}>Send</button>
		{#if sendError}<span class="self-center err">{sendError}</span>{/if}
		</div>
	</form>
	{/if}
</div>

{#if threadRoot}
	<aside class="flex w-[420px] shrink-0 flex-col border-l border-border bg-surface">
		<header class="pane-header gap-2 px-4 text-sm">
			<span class="text-muted">Threads</span><span class="text-muted">›</span><span class="truncate font-semibold">{threadRoot.text.slice(0, 40) || 'Thread'}</span>
			<span class="flex-1"></span>
			<button class="link-muted" onclick={() => (threadId = null)}><Icon name="x" class="size-4" /></button>
		</header>
		<div class="flex-1 overflow-y-auto px-4 py-3" bind:this={threadScroll}>
			<div class="flex gap-2.5">
				<div class="mt-5"><Avatar id={threadRoot.fromId} name={threadRoot.from} size={28} /></div>
				<div class="min-w-0 flex-1">
					<div class="mb-1 text-caption text-muted"><span class="text-text">{threadRoot.me ? 'You' : threadRoot.from}</span> · {when(threadRoot.at)}</div>
					<div class="rounded-lg bg-surface-2 px-3 py-1.5"><div class="teams-msg text-body leading-6 text-text">{@html cleanHtml(threadRoot.html)}</div></div>
				</div>
			</div>
			{#if threadOf(threadRoot).length}<div class="my-3 border-t border-border"></div>{/if}
			<div class="flex flex-col gap-3">
				{#each threadOf(threadRoot) as r (r.id)}
					<div class="flex gap-2.5">
						<div class="mt-5"><Avatar id={r.fromId} name={r.from} size={24} /></div>
						<div class="min-w-0 flex-1">
							<div class="mb-0.5 text-caption text-muted"><span class="{r.me ? 'text-accent' : 'text-text'}">{r.me ? 'You' : r.from}</span> · {when(r.at)}</div>
							<div class="rounded-lg px-3 py-1.5 {r.me ? 'bg-accent/25' : 'bg-surface-2'}"><div class="teams-msg text-body leading-6 text-text">{@html cleanHtml(r.html)}</div></div>
						</div>
					</div>
				{/each}
			</div>
		</div>
		<form class="shrink-0 border-t border-border p-3" onsubmit={(e) => (e.preventDefault(), sendReply())}>
			<div class="mb-1 text-caption text-muted">Send to: <span class="text-accent">thread only</span></div>
			<div class="flex gap-2">
				<textarea bind:this={threadBox} bind:value={threadDraft} rows="2" placeholder="Reply in thread" class="min-w-0 flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-body focus-accent" onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), void sendReply()); if (e.key === 'Escape') threadId = null; }}></textarea>
				<button class="btn-primary px-3 text-sm" disabled={!threadDraft.trim()}>Send</button>
			</div>
		</form>
	</aside>
{/if}
</section>
