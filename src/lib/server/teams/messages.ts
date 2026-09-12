// Chats, channel messages, threads, send/react/upload, file proxies, shared items, message caches.
import { env } from '$env/dynamic/private';
import { meta } from '../db';
import { nowIso } from '$lib/dates';
import { htmlToText, linkUrls } from '$lib/html';
import { DEMO, demoChats, demoMessages, demoChannelMessages } from '../demo';
import { type Upload } from '$lib/types';
import { CACHE_FRESH_MS, MIN, isPost, HOUR } from './shared';
import { onLogout, onLogin } from './auth';
import { graph, graphRaw, me, streamed } from './graph';
import { escape, fileProxy, isImage, proxied, rebuildBody, toMsg, type ChatMessage, type Quote, type RawMsg } from './render';
import { S, emit, recount } from './status';

export type ChatSummary = {
	id: string;
	topic: string | null;
	chatType: 'oneOnOne' | 'group' | 'meeting';
	webUrl: string;
	lastMessageReadDateTime: string;
	last: { at: string; from: string; preview: string } | null;
	unread: boolean;
	members: string[];
	memberIds: string[];
	people: { id: string; name: string; email?: string }[]; // paired, for stacked avatars + call links
};

type RawChat = {
	id: string; topic: string | null; chatType: ChatSummary['chatType']; webUrl: string;
	viewpoint?: { lastMessageReadDateTime: string };
	lastMessagePreview?: { createdDateTime: string; from?: { user?: { displayName?: string }; application?: { displayName?: string } } | null; body?: { content?: string; contentType?: string }; messageType?: string } | null;
	members?: { displayName?: string; userId?: string; email?: string }[];
};
// A chat whose latest item is a system event (call ended, member added…) stays in the list — it used to be
// dropped, so it vanished from the sidebar and links to it showed "Pick a chat". Such an item has no
// preview text worth showing and never counts as unread.
function toSummary(c: RawChat): ChatSummary {
	const lp = c.lastMessagePreview;
	const real = lp?.messageType === 'message';
	const read = c.viewpoint?.lastMessageReadDateTime ?? '';
	return {
		id: c.id, topic: c.topic, chatType: c.chatType, webUrl: c.webUrl,
		lastMessageReadDateTime: read,
		last: lp ? { at: lp.createdDateTime, from: real ? (lp.from?.user?.displayName ?? lp.from?.application?.displayName ?? '') : '', preview: real ? htmlToText(lp.body?.content ?? '').slice(0, 140) : '' } : null,
		unread: !!lp && real && lp.createdDateTime > read && lp.createdDateTime > (chatSeen[c.id] ?? ''),
		members: (c.members ?? []).map((m) => m.displayName ?? '').filter(Boolean),
		memberIds: (c.members ?? []).map((m) => m.userId ?? '').filter(Boolean),
		people: (c.members ?? []).filter((m) => m.userId).map((m) => ({ id: m.userId!, name: m.displayName ?? '', email: m.email ?? undefined }))
	};
}

export async function listChats(): Promise<ChatSummary[]> {
	if (DEMO()) return demoChats.map((c) => ({ ...c }));
	const r = await graph<{ value: RawChat[] }>('/me/chats?$expand=lastMessagePreview,members&$top=50&$orderby=lastMessagePreview/createdDateTime desc');
	// a chat nobody has written in yet has no preview to sort or show by
	return r.value.filter((c) => c.lastMessagePreview).map(toSummary);
}

/** One chat by id — for links to a chat older than the 50 in the list. Null if it can't be read. */
export async function chatById(id: string): Promise<ChatSummary | null> {
	if (DEMO()) return null;
	const c = await graph<RawChat>(`/me/chats/${encodeURIComponent(id)}?$expand=lastMessagePreview,members`).catch(() => null);
	return c ? toSummary(c) : null;
}

export const msgCache = new Map<string, { at: number; v: ChatMessage[] }>();
export async function chatMessagesCached(chatId: string, myId: string, maxAgeMs = CACHE_FRESH_MS): Promise<ChatMessage[]> {
	if (DEMO()) return demoMessages[chatId] ?? [];
	const c = msgCache.get(chatId);
	if (c && Date.now() - c.at < maxAgeMs) return c.v;
	const v = await chatMessages(chatId, myId);
	msgCache.set(chatId, { at: Date.now(), v });
	return v;
}
export const invalidateChat = (chatId: string) => msgCache.delete(chatId);

export async function chatMessages(chatId: string, myId: string): Promise<ChatMessage[]> {
	const r = await graph<{ value: RawMsg[] }>(`/me/chats/${encodeURIComponent(chatId)}/messages?$top=50`);
	return r.value.filter(isPost).map((m) => toMsg(m, myId)).reverse();
}

// stream Graph-hosted content (inline images) with our token
export async function hostedContent(url: string): Promise<Response> {
	// only message hostedContents ($value) — never a generic Graph proxy (token-scoped data exfil otherwise)
	if (!/^https:\/\/graph\.microsoft\.com\/(v1\.0|beta)\/(me|users\/[^/?#]+|chats\/[^/?#]+|teams\/[^/?#]+\/channels\/[^/?#]+)\/messages\/[^/?#]+(\/replies\/[^/?#]+)?\/hostedContents\/[^/?#]+\/\$value$/.test(url))
		throw new Error('bad url');
	const res = await graphRaw(url);
	if (!res.ok) throw new Error(`Graph ${res.status}`);
	return streamed(res);
}


// upload a non-image file to OneDrive (Teams' own chat-files folder) -> reference attachment
export async function uploadFile(f: Upload): Promise<{ id: string; name: string; contentUrl: string }> {
	const path = `/me/drive/root:/Microsoft Teams Chat Files/${encodeURIComponent(f.name)}:/content?@microsoft.graph.conflictBehavior=rename`;
	const item = await graph<{ id: string; eTag: string; webUrl: string; name: string }>(path, {
		method: 'PUT', headers: { 'content-type': f.type || 'application/octet-stream' }, body: Buffer.from(f.data, 'base64')
	});
	const guid = (item.eTag.match(/\{?([0-9a-f-]{36})\}?/i)?.[1] ?? item.id).toLowerCase();
	return { id: guid, name: item.name, contentUrl: item.webUrl };
}

// message body: text, optional quote (messageReference), inline images (hostedContents), file attachments (reference)
async function messagePayload(text: string, quote?: Quote | null, uploads: Upload[] = []) {
	let html = linkUrls(escape(text)).replace(/\n/g, '<br>');
	const attachments: unknown[] = [];
	const hostedContents: unknown[] = [];
	if (quote) {
		html = `<attachment id="${escape(quote.id)}"></attachment>${html}`;
		attachments.push({
			id: quote.id, contentType: 'messageReference',
			content: JSON.stringify({ messageId: quote.id, messagePreview: quote.preview, messageSender: { application: null, device: null, user: { userIdentityType: 'aadUser', id: quote.fromId, displayName: quote.from } } })
		});
	}
	let n = 0;
	for (const u of uploads) {
		if (u.type.startsWith('image/')) {
			const tid = String(++n);
			hostedContents.push({ '@microsoft.graph.temporaryId': tid, contentBytes: u.data, contentType: u.type });
			html += `${html ? '<br>' : ''}<img src="../hostedContents/${tid}/$value" alt="${escape(u.name)}">`;
		} else {
			const f = await uploadFile(u);
			attachments.push({ id: f.id, contentType: 'reference', contentUrl: f.contentUrl, name: f.name });
			html += `<attachment id="${f.id}"></attachment>`;
		}
	}
	return {
		body: { contentType: 'html', content: html },
		...(attachments.length ? { attachments } : {}),
		...(hostedContents.length ? { hostedContents } : {})
	};
}

export const sendChatMessage = async (chatId: string, text: string, quote?: Quote | null, uploads: Upload[] = []) =>
	graph<{ id: string }>(`/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: JSON.stringify(await messagePayload(text, quote, uploads)) });

// reactions
export const reactChat = (chatId: string, messageId: string, emoji: string, on: boolean) =>
	graph<void>(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/${on ? 'setReaction' : 'unsetReaction'}`, { method: 'POST', body: JSON.stringify({ reactionType: emoji }) });
export const reactChannel = (teamId: string, channelId: string, messageId: string, emoji: string, on: boolean) =>
	channelChanged(channelId, graph<void>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/${on ? 'setReaction' : 'unsetReaction'}`, { method: 'POST', body: JSON.stringify({ reactionType: emoji }) }));

// chats we've opened, keyed by the last message time seen — overrides Graph's viewpoint (which lags / can fail)
const chatSeen: Record<string, string> = meta.json('teams_chat_seen', {});
export const markChatSeenLocal = (chatId: string) => {
	const inCache = chatList.v?.find((x) => x.id === chatId);
	const lastAt = inCache?.last?.at ?? nowIso();
	// written only when it moves: an open chat reports every 10 s and this rewrote the whole map each time
	if (chatSeen[chatId] !== lastAt) {
		chatSeen[chatId] = lastAt;
		meta.setJson('teams_chat_seen', chatSeen);
	}
	if (inCache) inCache.unread = false;
	if (!S.status.unreadChats.some((x) => x.id === chatId)) return;
	const unreadChats = S.status.unreadChats.filter((x) => x.id !== chatId);
	S.status = { ...S.status, unreadChats, unread: recount(unreadChats) };
	emit('status');
	emit('chats');
};
export const markChatRead = (chatId: string, userId: string) =>
	DEMO() ? Promise.resolve() :
	graph<void>(`/chats/${encodeURIComponent(chatId)}/markChatReadForUser`, {
		method: 'POST',
		body: JSON.stringify({ user: { id: userId, tenantId: env.TEAMS_TENANT_ID } })
	}).catch((e) => console.warn('[teams] markChatRead failed:', String(e).slice(0, 160)));

// Fetch a shared SharePoint/OneDrive file via Graph shares API (needs Files.ReadWrite)
export async function sharedFile(sharingUrl: string): Promise<Response> {
	if (!/^https:\/\/[a-z0-9-]+\.sharepoint\.com\//i.test(sharingUrl) && !/^https:\/\/[a-z0-9-]+-my\.sharepoint\.com\//i.test(sharingUrl))
		throw new Error('bad url');
	const id = 'u!' + Buffer.from(sharingUrl).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
	const res = await graphRaw(`/shares/${id}/driveItem/content`, { redirect: 'follow' });
	if (!res.ok) throw new Error(`Graph ${res.status} ${(await res.text()).slice(0, 200)}`);
	// fallback name when SharePoint sends no content-disposition: the sharing URL's last path segment
	let name = '';
	try { name = decodeURIComponent(new URL(sharingUrl).pathname.split('/').pop() ?? ''); } catch { /* keep it nameless */ }
	return streamed(res, name);
}

export async function channelMessages(teamId: string, channelId: string, myId: string): Promise<ChatMessage[]> {
	if (DEMO()) return demoChannelMessages[channelId] ?? [];
	const r = await graph<{ value: RawMsg[] }>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=30&$expand=replies`);
	return r.value.filter(isPost).map((m) => toMsg(m, myId)).reverse();
}

// ---- open channels, cached. The poller refreshes an open channel every beat and used to announce it
// every beat too, so the page re-fetched 30 posts from Graph and re-rendered all of them every 5 s. Now
// the page reads this cache, and the poller announces only a real change (posts, replies, reactions, edits).
const channelCache = new Map<string, { at: number; sig: string; v: ChatMessage[] }>();
const signature = (v: ChatMessage[]) =>
	v.map((m) => `${m.id}:${m.html.length}:${m.replyCount ?? 0}:${m.replies?.at(-1)?.id ?? ''}:${m.reactions.map((r) => r.emoji + r.count).join('')}`).join('|');
export async function channelMessagesCached(teamId: string, channelId: string, myId: string, maxAge = 10_000): Promise<ChatMessage[]> {
	const hit = channelCache.get(channelId);
	if (hit && Date.now() - hit.at < maxAge) return hit.v;
	const v = await channelMessages(teamId, channelId, myId);
	channelCache.set(channelId, { at: Date.now(), sig: signature(v), v });
	return v;
}
/** Poller: re-read an open channel; true when something in it changed (the first read is not a change). */
export async function refreshChannel(teamId: string, channelId: string, myId: string): Promise<boolean> {
	const before = channelCache.get(channelId)?.sig;
	const v = await channelMessages(teamId, channelId, myId);
	const sig = signature(v);
	channelCache.set(channelId, { at: Date.now(), sig, v });
	return before !== undefined && sig !== before;
}
/** A channel changed outside the poller's refresh (a new post seen by the sweep): drop its cached copy. */
export const forgetChannel = (channelId: string) => channelCache.delete(channelId);
// our own writes must show on the very next read, not after the cache ages out
const channelChanged = <T>(channelId: string, p: Promise<T>) => p.then((r) => (channelCache.delete(channelId), r));
onLogout(() => channelCache.clear());

export const sendThreadReply = async (teamId: string, channelId: string, messageId: string, text: string, uploads: Upload[] = []) =>
	channelChanged(channelId, graph<{ id: string }>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies`, { method: 'POST', body: JSON.stringify(await messagePayload(text, null, uploads)) }));

// channel: quoting a post = replying in its thread
export const sendChannelMessage = async (teamId: string, channelId: string, text: string, quote?: Quote | null, uploads: Upload[] = []) =>
	channelChanged(channelId, quote
		? graph<{ id: string }>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(quote.id)}/replies`, { method: 'POST', body: JSON.stringify(await messagePayload(text, null, uploads)) })
		: graph<{ id: string }>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`, { method: 'POST', body: JSON.stringify(await messagePayload(text, null, uploads)) }));

const photoCache = new Map<string, { at: number; type: string; buf: ArrayBuffer | null }>();
onLogin(() => photoCache.clear());
// profile photo (48px), cached in memory; null when user has none
export async function userPhoto(userId: string): Promise<{ type: string; buf: ArrayBuffer } | null> {
	if (DEMO()) return null;
	if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('bad id');
	const c = photoCache.get(userId);
	// A user without a Teams photo doesn't grow one on the hour, and a miss costs a full Graph
	// round-trip that the browser pays per <img> — 23 of ~32 users here have none, which is seconds
	// of 404s every time the chat list repaints. Cache misses as long as hits; onLogin() above
	// clears everything, and adding a scope forces a sign-out/in anyway.
	if (c && Date.now() - c.at < (c.buf ? HOUR : 12 * HOUR)) return c.buf ? { type: c.type, buf: c.buf } : null;
	const res = await graphRaw(`/users/${userId}/photos/48x48/$value`, {}, undefined, 10_000); // the poller waits on these
	if (!res.ok) {
		// only "has no photo" (404) is remembered; a 401/429/5xx is a blip, and caching it hid a real
		// photo for 12 h
		if (res.status === 404) photoCache.set(userId, { at: Date.now(), type: '', buf: null });
		return null;
	}
	const buf = await res.arrayBuffer();
	const type = res.headers.get('content-type') ?? 'image/jpeg';
	photoCache.set(userId, { at: Date.now(), type, buf });
	return { type, buf };
}

// chat list from the last poll; the poller writes it, everything else reads it
export const chatList = { at: 0, v: null as ChatSummary[] | null };
// chat list from the last poll (≤20s old) — avoids a Graph round-trip on every navigation
export async function cachedChats(maxAgeMs = CACHE_FRESH_MS): Promise<ChatSummary[]> {
	if (chatList.v && Date.now() - chatList.at < maxAgeMs) return chatList.v;
	const v = await listChats();
	chatList.at = Date.now(); chatList.v = v;
	return v;
}

// ---- shared files + links in a chat/channel (scans history, cached 10 min)
export type SharedItem = { kind: 'file' | 'image' | 'link'; name: string; url: string; host?: string; at: string; by: string };
const sharedCache = new Map<string, { at: number; v: SharedItem[] }>();
export async function sharedItems(target: { chat: string } | { team: string; channel: string }, maxPages = 12): Promise<SharedItem[]> {
	const key = 'chat' in target ? target.chat : `${target.team}/${target.channel}`;
	const c = sharedCache.get(key);
	if (c && Date.now() - c.at < 10 * MIN) return c.v;
	type Raw = {
		id: string; createdDateTime: string; messageType: string; deletedDateTime?: string | null;
		from?: { user?: { displayName?: string }; application?: { displayName?: string } } | null;
		body: { contentType: string; content: string };
		attachments?: { id: string; name?: string; contentUrl?: string; contentType?: string; content?: string | null }[];
	};
	let url: string | null = 'chat' in target
		? `/me/chats/${encodeURIComponent(target.chat)}/messages?$top=50`
		: `/teams/${encodeURIComponent(target.team)}/channels/${encodeURIComponent(target.channel)}/messages?$top=50`;
	const out: SharedItem[] = [];
	const seen = new Set<string>();
	for (let page = 0; url && page < maxPages; page++) {
		const r: { value: Raw[]; '@odata.nextLink'?: string } = await graph(url);
		for (const m of r.value) {
			if (m.messageType !== 'message' || m.deletedDateTime) continue;
			const by = m.from?.user?.displayName ?? m.from?.application?.displayName ?? '';
			const at = m.createdDateTime;
			for (const a of m.attachments ?? []) {
				if (a.contentType === 'reference' && a.contentUrl && a.name) {
					const u = fileProxy(a.contentUrl);
					if (seen.has(u)) continue; seen.add(u);
					out.push({ kind: isImage(a.name) ? 'image' : 'file', name: a.name, url: u, at, by });
				}
			}
			for (const im of m.body.content.matchAll(/<img[^>]*src="(https:\/\/graph\.microsoft\.com\/[^"]+)"/g)) {
				const u = proxied(im[1]);
				if (seen.has(u)) continue; seen.add(u);
				out.push({ kind: 'image', name: `Image · ${new Date(at).toLocaleDateString()}`, url: u, at, by });
			}
			const text = m.body.content.replace(/<attachment[^>]*>.*?<\/attachment>/g, '');
			for (const l of text.matchAll(/href="(https?:\/\/[^"]+)"|(?<![="'>])(https?:\/\/[^\s<"']+)/g)) {
				const raw = (l[1] ?? l[2] ?? '').replace(/&amp;/g, '&').replace(/[.,;:!?)]+$/, '');
				if (!raw || /graph\.microsoft\.com|sharepoint\.com|teams\.microsoft\.com\/l\/message/.test(raw) || seen.has(raw)) continue;
				seen.add(raw);
				let host = ''; try { host = new URL(raw).host; } catch {}
				out.push({ kind: 'link', name: raw, url: raw, host, at, by });
			}
		}
		url = r['@odata.nextLink'] ?? null;
	}
	out.sort((a, b) => b.at.localeCompare(a.at));
	sharedCache.set(key, { at: Date.now(), v: out });
	return out;
}
onLogout(() => (chatList.v = null));

// ---- Editing and deleting your own messages
// Graph replaces the whole body on an update, so an edit re-sends the placeholder tags of everything it
// keeps (see ATT_TAG / IMG_TAG in render.ts). `keep` is the list of EditPart keys that survive; null means
// nothing was dropped, and then the attachments array is left alone rather than rewritten.
async function editPayload(path: string, text: string, keep: string[] | null): Promise<string> {
	const raw = await graph<RawMsg>(path);
	const content = rebuildBody(raw.body.contentType === 'html' ? raw.body.content : escape(raw.body.content), text, keep);
	const attachments = keep ? (raw.attachments ?? []).filter((a) => keep.includes(`att:${a.id}`)) : null;
	return JSON.stringify({ body: { contentType: 'html', content }, ...(attachments ? { attachments } : {}) });
}
export async function editChatMessage(chatId: string, messageId: string, text: string, keep: string[] | null): Promise<void> {
	const path = `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
	await graph<void>(path, { method: 'PATCH', body: await editPayload(path, text, keep) });
	invalidateChat(chatId);
}
export async function editChannelMessage(teamId: string, channelId: string, messageId: string, text: string, keep: string[] | null): Promise<void> {
	const path = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`;
	await channelChanged(channelId, graph<void>(path, { method: 'PATCH', body: await editPayload(path, text, keep) }));
}
export async function deleteChatMessage(chatId: string, messageId: string): Promise<void> {
	const my = await me(); // softDelete for a chat is only addressable under /users/{id}
	await graph<void>(`/users/${encodeURIComponent(my.id)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/softDelete`, { method: 'POST' });
	invalidateChat(chatId);
}
export const deleteChannelMessage = (teamId: string, channelId: string, messageId: string): Promise<void> =>
	channelChanged(channelId, graph<void>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/softDelete`, { method: 'POST' }));
