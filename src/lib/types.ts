import type { Status } from './columns';

export type Source = 'manual' | 'ticket';

export type Task = {
	id: number;
	title: string;
	notes: string; // manual tasks only
	description: string | null; // HubSpot ticket description, read-only, refreshed every sync
	hs_created_at: string | null; // when the ticket was opened in HubSpot
	submitted_via: string | null; // non-empty = the client opened it through the portal
	status: Status;
	sort_order: number;
	priority: number; // 0 none, 1 low, 2 medium, 3 high, 4 urgent
	due_date: string | null;
	source: Source;
	company_id: string | null;
	company_name?: string | null; // joined from companies
	last_client_at: string | null; // newest client message (portal note / incoming email)
	last_reply_at: string | null; // newest outgoing email from us
	checklist: string; // JSON ChecklistItem[] — local only
	hs_changed_at: string | null; // last HubSpot-side change we noticed (new / stage / reply)
	hs_seen_at: string | null; // when the user last opened the card
	hs_change: string | null; // 'new' | 'stage' | 'reply'
	hs_id: string | null;
	hs_pipeline: string | null;
	hs_stage: string | null;
	hs_stage_label?: string | null; // joined from stages
	hs_pipeline_label?: string | null;
	hs_url: string | null;
	hs_modified_at: string | null;
	hs_thread_id: string | null; // HubSpot conversation thread — the only route a reply reaches the portal
	seed_at: string | null; // when the seed email was sent; set before sending so a ticket is only ever mailed once
	created_at: string;
	updated_at: string;
};

export type Company = { id: string; name: string };

export type Attachment = { id: string; name: string; type: string; size: number; image: boolean };

export type Activity = {
	id: string;
	kind: 'note' | 'email' | 'request'; // request = the ticket description of a portal-submitted ticket
	at: string;
	author: string;
	subject?: string;
	body: string;
	portal: boolean;
	direction?: string;
	attachments: Attachment[];
};

export type Contact = { id: string; email: string | null; name: string; company_id?: string | null };
// picker items: contacts with an email at this company
export const contactsAt = (contacts: Contact[], companyId: string | null) =>
	companyId ? contacts.filter((c) => c.email && c.company_id === companyId).map((c) => ({ id: c.id, name: c.name.replace(/\s+/g, ' '), sub: c.email })) : [];

// file sent from the browser as base64 (HubSpot Files, Graph hostedContents, vault attachments)
export type Upload = { name: string; type: string; data: string };

// Teams chat/channel ids: channels end in @thread.tacv2
export const isChannelId = (id: string) => /@thread\.tacv2$/.test(id);
// loose on purpose: Graph validates for real; this only keeps obvious non-addresses out of invites
export const isEmail = (s: unknown): s is string => typeof s === 'string' && /.+@.+\..+/.test(s);
export const NOTIFY_LEVELS = ['all', 'quiet', 'off'] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];
export const defaultNotifyLevel = (id: string): NotifyLevel => (isChannelId(id) ? 'off' : 'all');

export type ChecklistItem = { id: string; text: string; done: boolean };
export const parseChecklist = (s: string | null | undefined): ChecklistItem[] => {
	try {
		const v = JSON.parse(s || '[]');
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
};

// hs_change kinds -> human label (Card badge, notifications)
export const CHANGE_LABEL: Record<string, string> = { new: 'New ticket', stage: 'Stage changed', reply: 'Client replied' };
// client message newer than our last reply, and the ticket is still open
export const needsReply = (t: { last_client_at: string | null; last_reply_at: string | null; status?: string }) =>
	!!t.last_client_at && t.last_client_at > (t.last_reply_at ?? '') && t.status !== 'done';
export const isUnseen = (t: { hs_changed_at?: string | null; hs_seen_at?: string | null }) =>
	!!t.hs_changed_at && t.hs_changed_at > (t.hs_seen_at ?? '');
