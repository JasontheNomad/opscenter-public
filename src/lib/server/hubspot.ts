import { env } from '$env/dynamic/private';
import { fetchRetry } from './fetchRetry';
import { nowIso } from '$lib/dates';
import { textToHtml, htmlToText, stripQuotedReply, escapeHtml } from '$lib/html';
import type { Attachment, Activity, Upload, Contact } from '$lib/types';
export type { Attachment, Activity, Upload, Contact };

const BASE = 'https://api.hubapi.com';
// HubSpot-defined association type ids used here
const ASSOC = { TICKET_COMPANY_PRIMARY: 26, TICKET_COMPANY: 339, TICKET_CONTACT: 16, NOTE_TICKET: 228, EMAIL_TICKET: 224, EMAIL_CONTACT: 198 } as const;
const assoc = (typeId: number) => ({ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId });
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// required: only tickets owned by this id are mirrored, and new tickets are assigned to it
export const OWNER_ID = (): string => {
	const id = env.HUBSPOT_OWNER_ID;
	if (!id) throw new Error('HUBSPOT_OWNER_ID is not set in .env');
	return id;
};
export const recordUrl = (objectTypeId: string, id: string) =>
	`https://${env.HUBSPOT_APP_HOST ?? 'app.hubspot.com'}/contacts/${env.HUBSPOT_PORTAL_ID}/record/${objectTypeId}/${id}`;


// burst limit (100 req / 10s): fetchRetry backs off on 429
async function hs<T>(path: string, init: RequestInit = {}): Promise<T> {
	if (!env.HUBSPOT_TOKEN) throw new Error('HUBSPOT_TOKEN not set');
	const res = await fetchRetry(BASE + path, {
		...init,
		headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}`, 'content-type': 'application/json', ...(init.headers ?? {}) }
	}, { attempts: 4, fallbackMs: (a) => 2500 * (a + 1), timeoutMs: 20_000 });
	if (!res.ok) throw new Error(`HubSpot ${res.status} ${path}: ${await res.text()}`);
	return res.status === 204 ? (undefined as T) : res.json();
}

export type Pipeline = {
	id: string;
	label: string;
	stages: {
		id: string;
		label: string;
		displayOrder: number;
		metadata: { ticketState?: string; state?: string; isClosed?: string };
	}[];
};

export type HsRecord = { id: string; properties: Record<string, string | null> };

type Page = { results: HsRecord[]; paging?: { next?: { after: string } } };

// Walk `paging.next.after` until exhausted (or maxPages). All list/search calls go through here.
async function paged(fetchPage: (after?: string) => Promise<Page>, maxPages = Infinity): Promise<HsRecord[]> {
	const out: HsRecord[] = [];
	let after: string | undefined;
	for (let i = 0; i < maxPages; i++) {
		const page = await fetchPage(after);
		out.push(...page.results);
		after = page.paging?.next?.after;
		if (!after) break;
	}
	return out;
}
type Filter = { propertyName: string; operator: string; value?: string; values?: string[] };
// `filters` is one AND group; pass several groups (OR'd) with `groups`
const searchAll = (objectType: string, filters: Filter[], properties: string[], extra: Record<string, unknown> = {}, maxPages?: number, groups?: Filter[][]) =>
	paged((after) => hs<Page>(`/crm/v3/objects/${objectType}/search`, { method: 'POST', body: JSON.stringify({ filterGroups: (groups ?? [filters]).map((f) => ({ filters: f })), properties, limit: 100, after, ...extra }) }), maxPages);
/**
 * My tickets that are still open, or closed within `closedDays` — the same set the board keeps. Asking
 * HubSpot for just those, rather than every ticket ever assigned (then dropping the old closed ones
 * locally), keeps each 90 s sync from growing with the history.
 */
export const searchTickets = (ownerId: string, properties: string[], closedDays: number) => {
	const owner: Filter = { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId };
	const since = String(Date.now() - closedDays * 86400_000);
	return searchAll('tickets', [], properties, {}, undefined, [
		[owner, { propertyName: 'closed_date', operator: 'NOT_HAS_PROPERTY' }],
		[owner, { propertyName: 'closed_date', operator: 'GTE', value: since }]
	]);
};
const listAll = (objectType: string, properties: string[]) =>
	paged((after) => hs<Page>(`/crm/v3/objects/${objectType}?${new URLSearchParams({ limit: '100', properties: properties.join(','), ...(after ? { after } : {}) })}`));

export const getPipelines = (objectType: 'tickets') =>
	hs<{ results: Pipeline[] }>(`/crm/v3/pipelines/${objectType}`).then((r) => r.results);

// `updatedAt` is the ticket's new modified time: stored as hs_modified_at so a lagging search result
// (older) can't win over our own write (sync.ts `newer`)
export const patchTicket = (id: string, properties: Record<string, string>) =>
	hs<{ updatedAt?: string }>(`/crm/v3/objects/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ properties }) });

// New ticket owned by me. Company optional (26 = ticket -> company primary, 339 = ticket -> company).
export type NewTicket = { subject: string; pipeline: string; stage: string; priority?: string | null; content?: string | null };
export const createTicket = ({ subject, pipeline, stage, priority, content }: NewTicket, companyId?: string | null) =>
	hs<{ id: string; updatedAt?: string }>('/crm/v3/objects/tickets', {
		method: 'POST',
		body: JSON.stringify({
			properties: {
				subject,
				hs_pipeline: pipeline,
				hs_pipeline_stage: stage,
				hubspot_owner_id: OWNER_ID(),
				...(priority ? { hs_ticket_priority: priority } : {}),
				...(content ? { content } : {})
			},
			associations: companyId
				? [
						{
							to: { id: companyId },
							types: [
								assoc(ASSOC.TICKET_COMPANY_PRIMARY),
								assoc(ASSOC.TICKET_COMPANY)
							]
						}
					]
				: []
		})
	});


// Contacts: full list, or only those modified since `since` (ISO) via search.
export async function listContacts(since?: string) {
	const props = ['email', 'firstname', 'lastname', 'associatedcompanyid'];
	const recs = since
		? await searchAll('contacts', [{ propertyName: 'lastmodifieddate', operator: 'GT', value: String(Date.parse(since)) }], props)
		: await listAll('contacts', props);
	return recs.map((r) => {
		const p = r.properties;
		return {
			id: r.id,
			name: `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.email || `Contact ${r.id}`,
			email: p.email || null,
			company_id: p.associatedcompanyid || null
		};
	});
}

// ticket -> contact association (HubSpot-defined typeId 16)
export const associateTicketContact = (ticketId: string, contactId: string) =>
	hs(`/crm/v4/objects/tickets/${encodeURIComponent(ticketId)}/associations/contacts/${encodeURIComponent(contactId)}`, {
		method: 'PUT',
		body: JSON.stringify([assoc(ASSOC.TICKET_CONTACT)])
	});

/**
 * Change a ticket's company: link the new one as primary (26) + plain (339), then drop the old link.
 * New first, so a refusal changes nothing and the ticket is never left without a company. Dropping the old
 * link explicitly makes the result the same whether or not HubSpot demotes a previous primary on its own.
 */
export async function setTicketCompany(ticketId: string, companyId: string | null, oldCompanyId: string | null) {
	const base = `/crm/v4/objects/tickets/${encodeURIComponent(ticketId)}/associations/companies`;
	if (companyId)
		await hs(`${base}/${encodeURIComponent(companyId)}`, {
			method: 'PUT',
			body: JSON.stringify([assoc(ASSOC.TICKET_COMPANY_PRIMARY), assoc(ASSOC.TICKET_COMPANY)])
		});
	if (oldCompanyId && oldCompanyId !== companyId) {
		try {
			await hs(`${base}/${encodeURIComponent(oldCompanyId)}`, { method: 'DELETE' });
		} catch (e) {
			// the new primary is set, which is what the app reads; a leftover secondary link is only clutter
			console.warn(`[hubspot] ticket ${ticketId}: old company ${oldCompanyId} still linked:`, e);
		}
	}
}

// Companies: full list, or only those modified since `since` (ISO) via search.
export async function listCompanies(since?: string): Promise<{ id: string; name: string }[]> {
	const recs = since
		? await searchAll('companies', [{ propertyName: 'hs_lastmodifieddate', operator: 'GT', value: String(Date.parse(since)) }], ['name'])
		: await listAll('companies', ['name']);
	return recs.map((r) => ({ id: r.id, name: r.properties.name ?? `Company ${r.id}` }));
}

// ---- activity (notes + emails) on a ticket

// HubSpot Files API. Needs `files` scope.
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

async function fileMeta(id: string): Promise<Attachment> {
	const f = await hs<{ id: string; name: string; extension?: string; type?: string; size?: number }>(`/files/v3/files/${id}`);
	const ext = (f.extension ?? '').toLowerCase();
	return {
		id: f.id,
		name: f.name + (ext ? `.${ext}` : ''),
		type: f.type ?? 'OTHER',
		size: f.size ?? 0,
		image: f.type === 'IMG' || IMAGE_EXT.includes(ext)
	};
}

export const fileSignedUrl = (id: string) =>
	hs<{ url: string; expiresAt: string }>(`/files/v3/files/${id}/signed-url`).then((r) => r.url);

// file metadata is immutable -> cache the promise; all files of an activity load in parallel
const metaCache = new Map<string, Promise<Attachment>>();
const fileMetaCached = (id: string) => {
	let p = metaCache.get(id);
	if (!p) {
		// a failed lookup shows a placeholder this once, but isn't remembered: a 429 or blip used to leave
		// the attachment as "file 123" with no thumbnail until the server restarted
		p = fileMeta(id).catch(() => {
			metaCache.delete(id);
			return { id, name: `file ${id}`, type: 'OTHER', size: 0, image: false };
		});
		metaCache.set(id, p);
	}
	return p;
};
const attachmentsOf = (ids: string | null | undefined) => Promise.all((ids ?? '').split(';').filter(Boolean).map(fileMetaCached));

const PORTAL_SOURCE = new RegExp(env.HUBSPOT_PORTAL_SOURCE || 'support portal', 'i');

let ownerCache: Map<string, string> | null = null;
async function ownerNames(): Promise<Map<string, string>> {
	if (ownerCache) return ownerCache;
	const m = new Map<string, string>();
	try {
		const r = await hs<{ results: { userId?: number; firstName?: string; lastName?: string; email?: string }[] }>(
			'/crm/v3/owners?limit=500'
		);
		for (const o of r.results)
			if (o.userId) m.set(String(o.userId), `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim() || o.email || String(o.userId));
		ownerCache = m; // only a real answer is kept: a failed call used to cache "nobody", so every author read "Team" until restart
	} catch {}
	return m;
}

export async function ticketActivity(ticketId: string): Promise<Activity[]> {
	const owners = await ownerNames();

	// notes: association ids -> batch read
	const noteIds = await hs<{ results: { toObjectId: number }[] }>(
		`/crm/v4/objects/tickets/${ticketId}/associations/notes`
	);
	// batch/read caps at 100 inputs -> chunk (long onboarding tickets exceed it)
	const noteRows: HsRecord[] = [];
	for (const part of chunk(noteIds.results, 100)) {
		const notes = await hs<Page>('/crm/v3/objects/notes/batch/read', {
			method: 'POST',
			body: JSON.stringify({
				inputs: part.map((r) => ({ id: String(r.toObjectId) })),
				properties: ['hs_note_body', 'hs_timestamp', 'hs_created_by_user_id', 'hs_object_source_detail_1', 'hs_attachment_ids']
			})
		});
		noteRows.push(...notes.results);
	}
	const toNote = async (n: HsRecord): Promise<Activity> => {
		const p = n.properties;
		const portal = PORTAL_SOURCE.test(p.hs_object_source_detail_1 ?? '');
		return {
			id: n.id,
			kind: 'note',
			at: p.hs_timestamp ?? '',
			author: portal ? 'Client (portal)' : (owners.get(p.hs_created_by_user_id ?? '') ?? 'Team'),
			body: htmlToText(p.hs_note_body ?? ''),
			portal,
			attachments: await attachmentsOf(p.hs_attachment_ids)
		};
	};

	// emails: search by ticket association (GET/list blocked under sales-email-read scope)
	const emails = await hs<Page>('/crm/v3/objects/emails/search', {
		method: 'POST',
		body: JSON.stringify({
			filterGroups: [
				{ filters: [{ propertyName: 'associations.ticket', operator: 'EQ', value: ticketId }] }
			],
			properties: [
				'hs_email_direction',
				'hs_email_subject',
				'hs_email_text',
				'hs_email_from_email',
				'hs_email_to_email',
				'hs_timestamp',
				'hs_created_by_user_id',
				'hs_attachment_ids'
			],
			limit: 100
		})
	});
	const toEmail = async (e: HsRecord): Promise<Activity> => {
		const p = e.properties;
		const incoming = p.hs_email_direction === 'INCOMING_EMAIL';
		return {
			id: e.id,
			kind: 'email',
			at: p.hs_timestamp ?? '',
			author: incoming ? (p.hs_email_from_email ?? 'Client') : (owners.get(p.hs_created_by_user_id ?? '') ?? p.hs_email_from_email ?? 'Team'),
			subject: p.hs_email_subject ?? undefined,
			body: stripQuotedReply((p.hs_email_text ?? '').trim()),
			portal: incoming,
			direction: p.hs_email_direction ?? undefined,
			attachments: await attachmentsOf(p.hs_attachment_ids)
		};
	};
	// the seed email (server/seed.ts) exists only to open the conversation thread — its subject carries
	// [#ticketId]. It is plumbing, not correspondence, so it never shows in the thread.
	const seeded = new RegExp(`\\[#${ticketId}\\]\\s*$`);
	const emailRows = emails.results.filter((e) => !seeded.test(e.properties.hs_email_subject ?? ''));
	const out = await Promise.all([...noteRows.map(toNote), ...emailRows.map(toEmail)]);
	return out.sort((a, b) => a.at.localeCompare(b.at));
}

// Upload to HubSpot Files (multipart; needs `files.write`). Returns file id for hs_attachment_ids.
export async function uploadFile(u: Upload, access: 'PRIVATE' | 'PUBLIC_NOT_INDEXABLE'): Promise<string> {
	if (!env.HUBSPOT_TOKEN) throw new Error('HUBSPOT_TOKEN not set');
	const fd = new FormData();
	fd.append('file', new Blob([Buffer.from(u.data, 'base64')], { type: u.type || 'application/octet-stream' }), u.name || `file-${Date.now()}`);
	fd.append('folderPath', '/opscenter');
	fd.append('options', JSON.stringify({ access, overwrite: false, duplicateValidationStrategy: 'NONE', duplicateValidationScope: 'EXACT_FOLDER' }));
	const res = await fetch(`${BASE}/files/v3/files`, { method: 'POST', headers: { authorization: `Bearer ${env.HUBSPOT_TOKEN}` }, body: fd });
	if (!res.ok) throw new Error(`HubSpot ${res.status} /files/v3/files: ${await res.text()}`);
	return String((await res.json()).id);
}
export const uploadAll = (ups: Upload[], access: 'PRIVATE' | 'PUBLIC_NOT_INDEXABLE') => Promise.all(ups.map((u) => uploadFile(u, access)));
const attachmentIds = (ids?: string[]) => (ids?.length ? { hs_attachment_ids: ids.join(';') } : {});

// Team note on a ticket (association 228 = note -> ticket). Plain text; newlines -> <br>.
export const createTicketNote = (ticketId: string, text: string, attachments?: string[]) =>
	hs<{ id: string }>('/crm/v3/objects/notes', {
		method: 'POST',
		body: JSON.stringify({
			properties: {
				hs_note_body: textToHtml(text),
				hs_timestamp: nowIso(),
				hubspot_owner_id: OWNER_ID(),
				...attachmentIds(attachments)
			},
			associations: [
				{
					to: { id: ticketId },
					types: [assoc(ASSOC.NOTE_TICKET)]
				}
			]
		})
	});

// ---- client reply: logged as an outgoing email engagement on the ticket + contact

export async function ticketContact(ticketId: string): Promise<Contact | null> {
	const assoc = await hs<{ results: { toObjectId: number }[] }>(
		`/crm/v4/objects/tickets/${ticketId}/associations/contacts`
	);
	const id = assoc.results[0]?.toObjectId;
	if (!id) return null;
	const c = await hs<HsRecord>(`/crm/v3/objects/contacts/${id}?properties=email,firstname,lastname`);
	const p = c.properties;
	return {
		id: c.id,
		email: p.email ?? null,
		name: `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.email || `Contact ${c.id}`
	};
}

let profileCache: { email: string; firstName: string; lastName: string } | null = null;
// the HubSpot owner this app acts as (From: on client replies)
async function ownerProfile() {
	if (profileCache) return profileCache;
	const o = await hs<{ email: string; firstName?: string; lastName?: string }>(
		`/crm/v3/owners/${OWNER_ID()}`
	);
	profileCache = { email: o.email, firstName: o.firstName ?? '', lastName: o.lastName ?? '' };
	return profileCache;
}

// ---- Conversations: the only route a reply reaches the client portal.
// /crm/v3/objects/emails writes a timeline record HubSpot never sends and the portal never renders. The
// portal renders conversation threads. A thread can only be born from an inbound message on a connected
// channel (server/seed.ts seeds one), so a ticket without a thread still falls back to the engagement.
const CONVERSATION_TICKET_ASSOC = 32;

export type ThreadRef = { id: string; channelId: string; channelAccountId: string };

export async function threadById(threadId: string): Promise<ThreadRef | null> {
	try {
		const t = await hs<{ id: string; originalChannelId: string; originalChannelAccountId: string }>(
			`/conversations/v3/conversations/threads/${threadId}`
		);
		return { id: t.id, channelId: t.originalChannelId, channelAccountId: t.originalChannelAccountId };
	} catch {
		return null; // deleted, or the id was the conversation session rather than the thread
	}
}

// A ticket associates to two conversation objects (the thread and its session) and the ids look alike,
// so each is probed and the one the Conversations API can actually read is the thread.
export async function ticketThreadId(ticketId: string): Promise<string | null> {
	const r = await hs<{ results: { toObjectId: number }[] }>(
		`/crm/v4/objects/tickets/${ticketId}/associations/conversation`
	);
	for (const a of r.results) if (await threadById(String(a.toObjectId))) return String(a.toObjectId);
	return null;
}

// How seed.ts finds the thread its own email just created: the seed subject carries a tag.
export async function findThreadBySubject(tag: string, sinceIso: string): Promise<string | null> {
	const q = new URLSearchParams({ limit: '50', sort: 'latestMessageTimestamp', latestMessageTimestampAfter: sinceIso });
	const page = await hs<{ results: { id: string }[] }>(`/conversations/v3/conversations/threads?${q}`);
	for (const t of page.results) {
		const msgs = await hs<{ results: { subject?: string }[] }>(
			`/conversations/v3/conversations/threads/${t.id}/messages`
		);
		if (msgs.results.some((m) => (m.subject ?? '').includes(tag))) return t.id;
	}
	return null;
}

export const associateThread = (ticketId: string, threadId: string) =>
	hs<void>(`/crm/v4/objects/tickets/${ticketId}/associations/conversation/${threadId}`, {
		method: 'PUT',
		body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: CONVERSATION_TICKET_ASSOC }])
	});

// The client portal renders the message body and ignores the attachment array, so images go into the
// body too. Client-reply files are uploaded PUBLIC_NOT_INDEXABLE, so `url` here is stable and openable.
async function inlineImages(ids: string[]): Promise<string> {
	const metas = await Promise.all(
		ids.map((id) =>
			hs<{ url?: string; type?: string; extension?: string }>(`/files/v3/files/${id}`).catch(() => null)
		)
	);
	return metas
		.filter((f) => f?.url && (f.type === 'IMG' || IMAGE_EXT.includes((f.extension ?? '').toLowerCase())))
		.map((f) => `<div style="margin-top:12px"><img src="${escapeHtml(f!.url as string)}" style="max-width:100%"></div>`)
		.join('');
}

async function replyInThread(thread: ThreadRef, subject: string, text: string, to: string, attachments?: string[]) {
	const images = attachments?.length ? await inlineImages(attachments) : '';
	const richText = textToHtml(text) + (images && text ? '<br>' : '') + images;
	return hs<{ id: string }>(`/conversations/v3/conversations/threads/${thread.id}/messages`, {
		method: 'POST',
		body: JSON.stringify({
			type: 'MESSAGE',
			text,
			richText,
			subject,
			senderActorId: `A-${OWNER_ID()}`,
			channelId: thread.channelId,
			channelAccountId: thread.channelAccountId,
			recipients: [{ recipientField: 'TO', deliveryIdentifier: { type: 'HS_EMAIL_ADDRESS', value: to } }],
			...(attachments?.length ? { attachments: attachments.map((fileId) => ({ fileId })) } : {})
		})
	});
}

export async function createTicketReply(ticketId: string, subject: string, text: string, attachments?: string[], threadId?: string | null) {
	const [contact, from] = await Promise.all([ticketContact(ticketId), ownerProfile()]);
	if (!contact?.email) throw new Error('ticket has no associated contact with an email');
	const thread = threadId ? await threadById(threadId) : null;
	if (thread) return replyInThread(thread, subject, text, contact.email, attachments);
	const html = textToHtml(text);
	const associations = [
		{ to: { id: ticketId }, types: [assoc(ASSOC.EMAIL_TICKET)] },
		{ to: { id: contact.id }, types: [assoc(ASSOC.EMAIL_CONTACT)] }
	];
	return hs<{ id: string }>('/crm/v3/objects/emails', {
		method: 'POST',
		body: JSON.stringify({
			properties: {
				hs_timestamp: nowIso(),
				hs_email_direction: 'EMAIL',
				hs_email_status: 'SENT',
				hs_email_subject: subject,
				hs_email_text: text,
				hs_email_html: html,
				hubspot_owner_id: OWNER_ID(),
				...attachmentIds(attachments),
				hs_email_headers: JSON.stringify({
					// the client portal only picks up replies whose from-address is the connected
					// inbox; the owner's own email lands in HubSpot but never reaches the portal
					from: { email: env.HUBSPOT_REPLY_FROM || from.email, firstName: from.firstName, lastName: from.lastName },
					to: [{ email: contact.email, firstName: contact.name }],
					cc: [],
					bcc: []
				})
			},
			associations
		})
	});
}

// ---- needs-reply: newest client message vs newest reply, per ticket. 4 calls for all tickets.

export type Latest = { last_client_at: string | null; last_reply_at: string | null };

async function ticketOf(objectType: 'notes' | 'emails', ids: string[]): Promise<Map<string, string>> {
	const m = new Map<string, string>();
	for (const part of chunk(ids, 100)) {
		const r = await hs<{ results: { from: { id: string }; to: { toObjectId: number }[] }[] }>(
			`/crm/v4/associations/${objectType}/tickets/batch/read`,
			{ method: 'POST', body: JSON.stringify({ inputs: part.map((id) => ({ id })) }) }
		);
		for (const row of r.results) if (row.to[0]) m.set(row.from.id, String(row.to[0].toObjectId));
	}
	return m;
}

export async function latestActivity(ticketIds: string[]): Promise<Map<string, Latest>> {
	const out = new Map<string, Latest>();
	if (ticketIds.length === 0) return out;
	const bump = (t: string, key: keyof Latest, at: string | null) => {
		if (!at) return;
		const cur = out.get(t) ?? { last_client_at: null, last_reply_at: null };
		if (!cur[key] || at > cur[key]!) cur[key] = at;
		out.set(t, cur);
	};
	// newest-first, paged: 100 per page across ALL tickets is not enough once threads get long
	const MAX_PAGES = 8;
	const byTicket = (objectType: 'emails' | 'notes', properties: string[]) =>
		searchAll(objectType, [{ propertyName: 'associations.ticket', operator: 'IN', values: ticketIds }], properties, { sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }] }, MAX_PAGES);
	const [emails, notes] = await Promise.all([byTicket('emails', ['hs_email_direction', 'hs_timestamp']), byTicket('notes', ['hs_timestamp', 'hs_object_source_detail_1'])]);
	const [eT, nT] = await Promise.all([
		ticketOf('emails', emails.map((r) => r.id)),
		ticketOf('notes', notes.map((r) => r.id))
	]);
	for (const e of emails) {
		const t = eT.get(e.id);
		if (!t) continue;
		const incoming = e.properties.hs_email_direction === 'INCOMING_EMAIL';
		bump(t, incoming ? 'last_client_at' : 'last_reply_at', e.properties.hs_timestamp);
	}
	for (const n of notes) {
		const t = nT.get(n.id);
		if (!t) continue;
		if (PORTAL_SOURCE.test(n.properties.hs_object_source_detail_1 ?? '')) bump(t, 'last_client_at', n.properties.hs_timestamp);
	}
	return out;
}
