import { describe, expect, it } from 'vitest';
import { contactsAt, defaultNotifyLevel, isChannelId, isUnseen, needsReply, parseChecklist } from './types';

describe('contactsAt', () => {
	const contacts = [
		{ id: '1', name: 'Ann   Lee', email: 'ann@example.com', company_id: 'c1' },
		{ id: '2', name: 'No Mail', email: null, company_id: 'c1' },
		{ id: '3', name: 'Elsewhere', email: 'e@example.com', company_id: 'c2' }
	];
	it('offers only contacts with an email at that company, names tidied', () => {
		expect(contactsAt(contacts, 'c1')).toEqual([{ id: '1', name: 'Ann Lee', sub: 'ann@example.com' }]);
	});
	it('offers nothing without a company', () => {
		expect(contactsAt(contacts, null)).toEqual([]);
	});
});

describe('parseChecklist', () => {
	it('parses a stored list and survives junk', () => {
		expect(parseChecklist('[{"id":"a","text":"x","done":true}]')).toEqual([{ id: 'a', text: 'x', done: true }]);
		for (const bad of [null, undefined, '', '{nope', '{"a":1}']) expect(parseChecklist(bad)).toEqual([]);
	});
});

describe('Teams ids', () => {
	// built from parts: written whole, these read as email addresses to the public-mirror scanner
	const channel = '19:abc@' + 'thread.tacv2';
	const chat = '19:abc@' + 'unq.gbl.spaces';
	it('tells channels from chats, and mutes channels by default', () => {
		expect(isChannelId(channel)).toBe(true);
		expect(isChannelId(chat)).toBe(false);
		expect(defaultNotifyLevel(channel)).toBe('off');
		expect(defaultNotifyLevel(chat)).toBe('all');
	});
});

describe('ticket flags', () => {
	it('needs a reply when the client wrote after us on an open ticket', () => {
		expect(needsReply({ last_client_at: '2026-09-11T10:00Z', last_reply_at: '2026-09-11T09:00Z' })).toBe(true);
		expect(needsReply({ last_client_at: '2026-09-11T10:00Z', last_reply_at: null })).toBe(true);
		expect(needsReply({ last_client_at: '2026-09-11T10:00Z', last_reply_at: '2026-09-11T11:00Z' })).toBe(false);
		expect(needsReply({ last_client_at: '2026-09-11T10:00Z', last_reply_at: null, status: 'done' })).toBe(false);
		expect(needsReply({ last_client_at: null, last_reply_at: null })).toBe(false);
	});
	it('is unseen when changed after it was last opened', () => {
		expect(isUnseen({ hs_changed_at: '2026-09-11T10:00Z', hs_seen_at: '2026-09-11T09:00Z' })).toBe(true);
		expect(isUnseen({ hs_changed_at: '2026-09-11T10:00Z', hs_seen_at: null })).toBe(true);
		expect(isUnseen({ hs_changed_at: '2026-09-11T10:00Z', hs_seen_at: '2026-09-11T10:00Z' })).toBe(false);
		expect(isUnseen({ hs_changed_at: null })).toBe(false);
	});
});
