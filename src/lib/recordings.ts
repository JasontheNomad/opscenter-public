// Teams meeting recordings as notes. Pure: naming, client matching and the note text. Fetching and
// writing live in server/recordings.ts; the player in a note is drawn by mdMarks.ts.

// Teams names a recording "<meeting title>-YYYYMMDD_HHMMSS-Meeting Recording.mp4", dropping the
// characters a file name can't hold from the title ("Acme / Co" arrives as "Acme  Co").
export function recordingTitle(name: string): string {
	const m = /^(.*)-\d{8}_\d{6}-Meeting Recording\.[a-z0-9]+$/i.exec(name);
	return (m ? m[1] : name.replace(/\.[a-z0-9]+$/i, '')).trim();
}

/** Loose key for comparing a calendar title with what survived in the file name. */
export const titleKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A company website as HubSpot stores it ("www.acme.com", "https://Acme.com/about") → "acme.com". */
export function normalizeDomain(d: string | null | undefined): string | null {
	const host = (d ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '');
	return host.includes('.') ? host : null;
}

// Mailbox providers: an address there says nothing about the company.
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);

export type CompanyLookup = {
	byEmail: (email: string) => string | null; // the HubSpot contact's company
	byDomain: (domain: string) => string | null; // the one company with this website domain
	byTitle: (title: string) => string | null; // the one company named in the meeting title
};

/**
 * The client a meeting belongs to. Each outside attendee votes for a company — their HubSpot contact's,
 * else their email domain's — and the most votes wins; a tie is nobody. With no votes, a company named in
 * the title ("Jason and Acme Law", as HubSpot bookings read). Nobody is better than the wrong client.
 */
export function meetingCompany(emails: string[], title: string, internal: string[], lookup: CompanyLookup): string | null {
	const inside = new Set(internal.map((d) => d.trim().toLowerCase()).filter(Boolean));
	const votes = new Map<string, number>();
	for (const email of new Set(emails.map((e) => e.trim().toLowerCase()))) {
		const domain = email.split('@')[1];
		if (!domain || inside.has(domain)) continue;
		const id = lookup.byEmail(email) ?? (FREE_MAIL.has(domain) ? null : lookup.byDomain(domain));
		if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
	}
	if (!votes.size) return lookup.byTitle(title);
	const ranked = [...votes].sort((a, b) => b[1] - a[1]);
	return ranked.length > 1 && ranked[0][1] === ranked[1][1] ? null : ranked[0][0];
}

// The video plays from OpsCenter's own /api/recordings/<OneDrive item id>, which hands the browser a
// short-lived pre-signed link. (Microsoft's Stream player can't be framed: it needs a sign-in the browser
// won't give a frame.) Same-origin paths only, so a note can never point a player anywhere else.
const RECORDING_SRC = /^\/api\/recordings\/[A-Za-z0-9!_-]{1,200}$/;
export const isRecordingSrc = (src: string) => RECORDING_SRC.test(src);
export const recordingSrc = (itemId: string): string | null => (isRecordingSrc(`/api/recordings/${itemId}`) ? `/api/recordings/${itemId}` : null);

// ---- transcript: Teams serves it as WebVTT, one cue per utterance, speaker in a `<v Name>` voice tag

export type Turn = { at: number; speaker: string; text: string }; // `at` = seconds into the call

const CUE_TIME = /^(?:(\d+):)?(\d{2}):(\d{2})[.,]\d{3}\s+-->/;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

/** WebVTT → speaker turns: consecutive cues from the same speaker become one turn. */
export function vttTurns(vtt: string): Turn[] {
	const turns: Turn[] = [];
	for (const block of vtt.replace(/\r/g, '').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const i = lines.findIndex((l) => CUE_TIME.test(l));
		if (i < 0) continue; // the WEBVTT header, a NOTE, a style block
		const [, h, m, s] = CUE_TIME.exec(lines[i])!;
		const raw = lines.slice(i + 1).join(' ');
		const speaker = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(raw)?.[1].trim() ?? '';
		const text = raw
			.replace(/<[^>]*>/g, '')
			.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
			.replace(/\s+/g, ' ')
			.trim();
		if (!text) continue;
		const last = turns.at(-1);
		if (last && last.speaker === speaker) last.text += ` ${text}`;
		else turns.push({ at: Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s), speaker, text });
	}
	return turns;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (sec: number) => {
	const h = Math.floor(sec / 3600);
	return `${h ? `${h}:` : ''}${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
};

/** The `## Transcript` section added under a recording note. Each turn starts its own line with `**`, so no
 * spoken text can ever sit at the start of a line and be read as a heading or a player. */
export function transcriptSection(turns: Turn[] | null): string {
	if (!turns?.length) return '## Transcript\n\n_No transcript is available for this call._\n';
	return `## Transcript\n\n${turns.map((t) => `**[${stamp(t.at)}]${t.speaker ? ` ${t.speaker}:` : ''}** ${t.text}`).join('\n\n')}\n`;
}

export type RecordingNote = { start: Date; minutes: number | null; attendees: string[]; video: string | null; link: string };

/** The note under its `# title`: the player (when there is one), a plain link that always works, details. */
export function recordingNote(r: RecordingNote): string {
	const when = r.start.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
	const link = r.link.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
	return [
		...(r.video ? [`<video src="${r.video}" controls></video>`, ''] : []),
		`[Watch the recording](${link})`,
		'',
		`- **When:** ${when}${r.minutes ? ` · ${r.minutes} min` : ''}`,
		...(r.attendees.length ? [`- **Attendees:** ${r.attendees.join(', ')}`] : []),
		''
	].join('\n');
}
