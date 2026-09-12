import { describe, expect, it } from 'vitest';
import { clientThread, descriptionText, teamNotes } from './activity';
import type { Activity, Attachment } from './types';

const shot: Attachment = { id: 'f1', name: 'screen.png', type: 'image/png', size: 10, image: true };
const act = (id: string, at: string, over: Partial<Activity> = {}): Activity => ({ id, kind: 'note', at, author: 'x', body: 'hi', portal: false, attachments: [], ...over });
const ticket = (over = {}) => ({ submitted_via: null, description: null, hs_created_at: '2026-09-01T10:00:00Z', created_at: '2026-09-01T10:05:00Z', ...over });

describe('descriptionText', () => {
	it('keeps plain text, converts HTML, handles null', () => {
		expect(descriptionText('  printer broken ')).toBe('printer broken');
		expect(descriptionText('<p>printer <b>broken</b></p>')).toBe('printer broken');
		expect(descriptionText(null)).toBe('');
	});
});

describe('teamNotes', () => {
	it('keeps team notes only, newest first', () => {
		const list = [act('a', '1'), act('b', '2', { kind: 'email' }), act('c', '3', { portal: true }), act('d', '4')];
		expect(teamNotes(list).map((a) => a.id)).toEqual(['d', 'a']);
	});
});

describe('clientThread', () => {
	it('keeps emails and portal messages, in order, when the ticket is ours', () => {
		const list = [act('a', '2026-09-01T11:00:00Z', { kind: 'email' }), act('b', '2026-09-01T12:00:00Z'), act('c', '2026-09-01T13:00:00Z', { portal: true })];
		expect(clientThread(list, ticket({ description: 'ours' })).map((a) => a.id)).toEqual(['a', 'c']);
	});

	it('opens a portal ticket with the request and folds in its screenshot note', () => {
		const screenshot = act('s', '2026-09-01T10:03:00Z', { portal: true, body: 'Attached: screen.png', attachments: [shot] });
		const later = act('l', '2026-09-01T12:00:00Z', { portal: true, body: 'any news?', attachments: [shot] });
		const out = clientThread([screenshot, later], ticket({ submitted_via: 'portal', description: '<p>It broke</p>' }));
		expect(out.map((a) => a.id)).toEqual(['request', 'l']);
		expect(out[0]).toMatchObject({ kind: 'request', body: 'It broke', at: '2026-09-01T10:00:00Z', attachments: [shot] });
	});

	it('does not fold a screenshot sent much later, or one with text', () => {
		const late = act('late', '2026-09-01T11:00:00Z', { portal: true, body: '', attachments: [shot] });
		const texty = act('texty', '2026-09-01T10:02:00Z', { portal: true, body: 'see this', attachments: [shot] });
		const out = clientThread([late, texty], ticket({ submitted_via: 'portal', description: 'It broke' }));
		expect(out.map((a) => a.id)).toEqual(['request', 'texty', 'late']);
		expect(out[0].attachments).toEqual([]);
	});

	it('falls back to created_at when HubSpot has no open time', () => {
		const out = clientThread([], ticket({ submitted_via: 'portal', description: 'x', hs_created_at: null }));
		expect(out[0].at).toBe('2026-09-01T10:05:00Z');
	});
});
