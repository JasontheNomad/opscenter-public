import { describe, expect, it } from 'vitest';
import { isRecordingSrc, meetingCompany, normalizeDomain, recordingNote, recordingSrc, recordingTitle, titleKey, transcriptSection, vttTurns, type CompanyLookup } from './recordings';

describe('vttTurns', () => {
	const vtt = [
		'WEBVTT',
		'',
		'1a2b/12-0',
		'00:00:03.520 --> 00:00:06.160',
		'<v Ann Lee>Hi, can you hear me?</v>',
		'',
		'1a2b/13-0',
		'00:00:06.500 --> 00:00:08.000',
		'<v Ann Lee>Great &amp; thanks.</v>',
		'',
		'00:01:10.000 --> 00:01:12.000',
		'<v Bob Ray>Yes —',
		'loud and clear.</v>',
		'',
		'01:02:03.000 --> 01:02:05.000',
		'no speaker here'
	].join('\n');

	it('turns cues into speaker turns, merging a speaker’s consecutive cues', () => {
		expect(vttTurns(vtt)).toEqual([
			{ at: 3, speaker: 'Ann Lee', text: 'Hi, can you hear me? Great & thanks.' },
			{ at: 70, speaker: 'Bob Ray', text: 'Yes — loud and clear.' },
			{ at: 3723, speaker: '', text: 'no speaker here' }
		]);
	});

	it('handles CRLF and an empty transcript', () => {
		expect(vttTurns('WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\n<v A>x</v>')).toEqual([{ at: 1, speaker: 'A', text: 'x' }]);
		expect(vttTurns('WEBVTT\n\n')).toEqual([]);
	});
});

describe('transcriptSection', () => {
	it('writes one line per turn, stamped, and says so when there is none', () => {
		expect(transcriptSection(vttTurns('WEBVTT\n\n01:02:03.000 --> 01:02:04.000\n<v Ann>hello</v>\n\n01:02:05.000 --> 01:02:06.000\nbye'))).toBe(
			'## Transcript\n\n**[1:02:03] Ann:** hello\n\n**[1:02:05]** bye\n'
		);
		expect(transcriptSection(null)).toContain('No transcript is available');
		expect(transcriptSection([])).toContain('No transcript is available');
	});

	it('never lets spoken text start a line', () => {
		const out = transcriptSection([{ at: 0, speaker: 'X', text: '<video src="/api/recordings/1" controls></video>' }]);
		expect(out.split('\n').filter((l) => l.startsWith('<video'))).toEqual([]);
	});
});

const FILE = 'Jason and Acme  0-1 LLC-20260909_085944-Meeting Recording.mp4';

describe('recordingTitle', () => {
	it('takes the meeting title out of a Teams recording file name', () => {
		expect(recordingTitle(FILE)).toBe('Jason and Acme  0-1 LLC');
		expect(recordingTitle('Other clip.mp4')).toBe('Other clip');
	});

	it('matches the calendar title once dropped characters are ignored', () => {
		expect(titleKey(recordingTitle(FILE))).toBe(titleKey('Jason and Acme / 0-1 LLC'));
	});
});

describe('normalizeDomain', () => {
	it('reduces a website to its bare domain', () => {
		expect(normalizeDomain('www.acme.example')).toBe('acme.example');
		expect(normalizeDomain('https://Acme.example/about')).toBe('acme.example');
		expect(normalizeDomain('')).toBeNull();
		expect(normalizeDomain('localhost')).toBeNull();
	});
});

describe('meetingCompany', () => {
	const lookup = (contacts: Record<string, string>, domains: Record<string, string>, title: string | null = null): CompanyLookup => ({
		byEmail: (e) => contacts[e] ?? null,
		byDomain: (d) => domains[d] ?? null,
		byTitle: () => title
	});

	it('votes by contact, then by domain, and leaves our own people out', () => {
		const emails = ['me@us.example', 'ann@firm.example', 'Bob@firm.example'];
		expect(meetingCompany(emails, 't', ['us.example'], lookup({ 'ann@firm.example': 'c1' }, { 'firm.example': 'c1', 'us.example': 'us' }))).toBe('c1');
	});

	it('gives the meeting to the company with most attendees, and a tie to nobody', () => {
		const l = lookup({}, { 'a.example': 'ca', 'b.example': 'cb' }, 'from-title');
		expect(meetingCompany(['x@a.example', 'y@a.example', 'z@b.example'], 't', [], l)).toBe('ca');
		expect(meetingCompany(['x@a.example', 'z@b.example'], 't', [], l)).toBeNull();
	});

	it('falls back to the title only when no attendee matched', () => {
		expect(meetingCompany(['x@nowhere.example'], 'Jason and Acme', [], lookup({}, {}, 'c9'))).toBe('c9');
		expect(meetingCompany([], 'Jason and Acme', [], lookup({}, {}, null))).toBeNull();
	});
});

describe('recordingSrc', () => {
	it('plays a OneDrive item from our own endpoint', () => {
		expect(recordingSrc('01ABCDEF2GHIJ3KLMN')).toBe('/api/recordings/01ABCDEF2GHIJ3KLMN');
		expect(isRecordingSrc('/api/recordings/01ABCDEF2GHIJ3KLMN')).toBe(true);
	});

	it('refuses a malformed id, and any source that is not that endpoint', () => {
		expect(recordingSrc('x"><script>')).toBeNull();
		expect(recordingSrc('../files/1')).toBeNull();
		expect(isRecordingSrc('https://evil.example/api/recordings/1')).toBe(false);
		expect(isRecordingSrc('//evil.example/api/recordings/1')).toBe(false);
		expect(isRecordingSrc('/api/files/1')).toBe(false);
	});
});

describe('recordingNote', () => {
	it('puts the player above a link that always works, then the details', () => {
		const note = recordingNote({ start: new Date('2026-09-09T16:00:00Z'), minutes: 24, attendees: ['Ann', 'Bob'], video: '/api/recordings/01AB', link: 'https://t-my.sharepoint.example/a b(c).mp4' });
		const lines = note.split('\n');
		expect(lines[0]).toBe('<video src="/api/recordings/01AB" controls></video>');
		expect(lines[2]).toBe('[Watch the recording](https://t-my.sharepoint.example/a%20b%28c%29.mp4)');
		expect(note).toContain('· 24 min');
		expect(note).toContain('- **Attendees:** Ann, Bob');
	});

	it('has just the link when there is no player', () => {
		expect(recordingNote({ start: new Date(), minutes: null, attendees: [], video: null, link: 'https://x.example/v' }).startsWith('[Watch the recording]')).toBe(true);
	});
});
