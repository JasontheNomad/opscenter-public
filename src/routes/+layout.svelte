<script lang="ts">
	import { post } from '$lib/api';
	import { PROJECT_PIPELINE_LABEL } from '$lib/views';
	import { CHANGE_LABEL } from '$lib/types';
	import { badgeCount } from '$lib/status';
	import './layout.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Lightbox from '$lib/components/Lightbox.svelte';
	import CallView from '$lib/components/CallView.svelte';
	import PreJoin from '$lib/components/PreJoin.svelte';
	import { calls } from '$lib/calls/engine.svelte';
	import CallNotices from '$lib/components/CallNotices.svelte';
	import IncomingCall from '$lib/components/IncomingCall.svelte';
	import { callWindow } from '$lib/calls/window.svelte';
	import TextSizePanel from '$lib/components/TextSizePanel.svelte';
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { untrack } from 'svelte';

	let { data, children } = $props();

	// app-wide Teams activity: server polls Graph every 20s; we read the cached status every 20s
	type Status = typeof data.teams;
	// follows data.teams on every load; the 20 s tick and SSE events overwrite it in between
	let teams = $derived<Status>(data.teams);
	// Web Notifications from the PWA itself (shows as "OpsCenter", click jumps to the chat/channel)
	type Unread = { id: string; title: string; at: string; teamId?: string; level?: string };
	const seenKey = 'ocNotified';
	let notified: Record<string, string> = {};
	try { notified = JSON.parse(localStorage.getItem(seenKey) ?? '{}'); } catch {}
	let primed = false;
	const appActive = () => document.hasFocus() && document.visibilityState === 'visible';
	const canNotify = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
	// one banner per (key, timestamp); click jumps to href. Quiet / first load / window active -> bubble only.
	function notifyOnce(key: string, at: string, quiet: boolean, build: () => { title: string; body: string; href: string }) {
		if (!at || notified[key] === at) return;
		notified[key] = at;
		if (!primed || quiet || appActive() || !canNotify()) return;
		const { title, body, href } = build();
		const n = new Notification(title, { body, tag: key, icon: '/icon-192.png', badge: '/icon-192.png' });
		n.onclick = () => { window.focus(); location.href = href; n.close(); };
	}
	function maybeNotify(items: Unread[], kind: 'chat' | 'channel') {
		for (const it of items)
			notifyOnce(it.id, it.at, it.level !== 'all', () => ({
				title: kind === 'channel' ? `# ${it.title}` : it.title,
				body: 'New message',
				href: kind === 'channel' ? `/teams/channel/${encodeURIComponent(it.teamId ?? '')}/${encodeURIComponent(it.id)}` : `/teams/${encodeURIComponent(it.id)}`
			}));
	}
	function maybeNotifyHs(items: { id: number; title: string; kind: string | null; at: string; pipeline_label: string | null }[]) {
		for (const it of items) {
			const view = it.pipeline_label === PROJECT_PIPELINE_LABEL ? 'projects' : 'support';
			notifyOnce(`hs-${it.id}`, it.at, false, () => ({
				title: `${view === 'projects' ? 'Projects' : 'Support'} · ${CHANGE_LABEL[it.kind ?? ''] ?? 'Changed'}`,
				body: it.title,
				href: `/${view}?task=${it.id}`
			}));
		}
	}
	// keep only what's still unread: the map got one entry per chat/channel/ticket ever alerted, forever.
	// (A new message has a new timestamp, so forgetting an old one can't cause a repeat banner.)
	const persistNotified = (live: string[]) => {
		notified = Object.fromEntries(Object.entries(notified).filter(([k]) => live.includes(k)));
		try { localStorage.setItem(seenKey, JSON.stringify(notified)); } catch {}
	};
	const tick = async () => {
		try {
			const r = await fetch('/api/teams/status');
			if (r.ok) {
				teams = await r.json();
				maybeNotify(teams.unreadChats ?? [], 'chat');
				maybeNotify((teams.unreadChannels ?? []) as Unread[], 'channel');
				maybeNotifyHs(teams.hubspot?.items ?? []);
				persistNotified([...(teams.unreadChats ?? []), ...(teams.unreadChannels ?? [])].map((u) => u.id).concat((teams.hubspot?.items ?? []).map((i) => `hs-${i.id}`)));
				primed = true;
			}
		} catch {}
	};
	// first interaction: ask notification permission, and unlock the ringtone (autoplay needs a gesture)
	$effect(() => {
		const ask = () => {
			if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
			calls.primeAudio();
			window.removeEventListener('pointerdown', ask);
			window.removeEventListener('keydown', ask);
		};
		window.addEventListener('pointerdown', ask);
		window.addEventListener('keydown', ask);
		return () => { window.removeEventListener('pointerdown', ask); window.removeEventListener('keydown', ask); };
	});
	$effect(() => {
		const id = setInterval(tick, 20_000);
		// the app's one live connection (browsers cap them per host); /teams hears it as `oc:teams`
		const es = new EventSource('/api/teams/events');
		for (const type of ['chats', 'channels', 'status'])
			es.addEventListener(type, () => { void tick(); dispatchEvent(new CustomEvent('oc:teams', { detail: type })); });
		// `omarchy theme set` on the desktop: re-run the root load only, which re-renders the palette
		es.addEventListener('theme', () => invalidate('app:theme'));
		return () => { clearInterval(id); es.close(); };
	});
	// tell the server whether the window is active and which chat/channel is open (every 10s + on change).
	// Each window reports under its own id, so the Mac's and the Arch's windows don't overwrite each other.
	const windowId = crypto.randomUUID();
	$effect(() => {
		const report = () => {
			const m = location.pathname.match(/^\/teams\/channel\/[^/]+\/([^/?#]+)/) ?? null;
			const c = !m ? location.pathname.match(/^\/teams\/(?!mentions$|threads$|channel\/)([^/?#]+)/) : null;
			post('/api/teams/focus', { client: windowId, focused: appActive(), notify: canNotify(), chat: c ? decodeURIComponent(c[1]) : null, channel: m ? decodeURIComponent(m[1]) : null }).catch(() => {});
		};
		page.url.pathname; // re-run on navigation
		report();
		const id = setInterval(report, 10_000);
		window.addEventListener('focus', report); window.addEventListener('blur', report); document.addEventListener('visibilitychange', report);
		return () => { clearInterval(id); window.removeEventListener('focus', report); window.removeEventListener('blur', report); document.removeEventListener('visibilitychange', report); };
	});
	// navigating (e.g. opening a chat/channel) refreshes the bubble right away
	$effect(() => {
		page.url.pathname;
		setTimeout(tick, 300);
	});
	// PWA Dock icon badge
	$effect(() => {
		const n = badgeCount(teams, true);
		try {
			const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
			// the promise can reject (no permission, unsupported) — a try block does not catch that
			if (n > 0) nav.setAppBadge?.(n)?.catch(() => {}); else nav.clearAppBadge?.()?.catch(() => {});
		} catch {}
	});

	// calls and meetings open in their own window (see $lib/calls/window.svelte.ts)
	$effect(() => calls.onWindow((title) => callWindow.open(title)));
	// ...which closes when the call ends. Keyed on Disconnected rather than "not in a call": a call
	// that has only just been placed can still report 'None' for a moment.
	$effect(() => {
		if (calls.callState === 'Disconnected') untrack(() => { if (!calls.pending) callWindow.close(); });
	});
</script>

<svelte:head>
	<link rel="icon" href="/icon-192.png" /><title>OpsCenter</title>
	<!-- Omarchy palette, server-rendered so the themed colours are there on first paint. Hex-only
	     (validated in server/theme.ts); @html keeps Svelte from treating it as a component style. -->
	{#if data.theme}{@html `<style>${data.theme.css}</style>`}{/if}
	<!-- PWA title bar. Follows the theme's `surface`, which is what the sidebar and the
	     window-controls-overlay strip paint; falls back to the layout.css surface. -->
	<meta name="theme-color" content={data.theme?.surface || '#151619'} />
</svelte:head>

<Lightbox />
{#if !callWindow.win}
	<!-- only when the browser blocked the call window: same screens, full-size in the app -->
	{#if calls.pending}
		<PreJoin
			title={calls.pending.title}
			sub={calls.pending.sub}
			startVideo={calls.pending.video}
			onjoin={(o) => calls.confirmPending(o)}
			oncancel={() => calls.cancelPending()}
		/>
	{/if}
	<CallView />
	<CallNotices />
{:else if calls.inCall || calls.pending}
	<button class="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text shadow-lg hover:border-accent" onclick={() => callWindow.focus()}>
		<span class="size-2 rounded-full bg-avail"></span>In a call · Show
	</button>
{/if}
<IncomingCall />
<TextSizePanel />
<div class="titlebar-drag" aria-hidden="true"></div>
<div class="app-frame flex">
	<Sidebar counts={data.counts} {teams} />
	<div class="flex min-w-0 flex-1">{@render children()}</div>
</div>
