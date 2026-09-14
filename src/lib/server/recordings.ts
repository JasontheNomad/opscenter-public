// Teams recordings → a note in the client's folder, or in Unclassified, with the player embedded.
//
// Teams saves the recording of a meeting Jason organizes to his OneDrive "Recordings" folder. The file
// appears when recording starts and keeps growing until it stops, so it's only taken once it has sat
// unchanged for SETTLE_MS. Its meeting is found in the calendar by title and time; the client by who
// attended ($lib/recordings `meetingCompany`). Only recordings made after this first ran are picked up,
// and each becomes a note once (`recordings` table). The transcript is added under the note later — Teams
// often finishes it after the recording — and stays even when the recording itself expires.
import { env } from '$env/dynamic/private';
import { db, meta } from './db';
import { errMsg } from '$lib/api';
import { DEMO } from './demo';
import { graph, graphRaw, me, teamsConnected } from './teams';
import { createFolder, createNote, ensureClientFolders, folderForCompany, readNote, writeNote } from './notes';
import { nowIso, ymd } from '$lib/dates';
import { meetingCompany, recordingNote, recordingSrc, recordingTitle, titleKey, transcriptSection, vttTurns, type Turn } from '$lib/recordings';

const SINCE = 'recordings_since';
const SETTLE_MS = 15 * 60_000;
const MATCH_WINDOW_MS = 3 * 3600_000;
// how long to keep looking for a transcript after the note is made (a late sign-in to grant the scope included)
const TRANSCRIPT_WAIT_MS = 3 * 86_400_000;
export const UNCLASSIFIED = 'Unclassified';

type Item = {
	id: string; name: string; createdDateTime: string; lastModifiedDateTime: string; webUrl: string;
	file?: { mimeType?: string }; video?: { duration?: number };
};
type Meeting = {
	subject?: string; start: { dateTime: string }; onlineMeeting?: { joinUrl?: string } | null;
	attendees?: { emailAddress?: { name?: string; address?: string } }[];
};

const taken = db.prepare('SELECT 1 FROM recordings WHERE item_id = ?');
const remember = db.prepare(
	'INSERT OR IGNORE INTO recordings (item_id, folder, file, created_at, recorded_at, join_url, transcript) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const contactCompany = db.prepare("SELECT company_id FROM contacts WHERE lower(email) = ? AND company_id IS NOT NULL AND company_id <> '' LIMIT 1").pluck();
const domainCompanies = db.prepare('SELECT id FROM companies WHERE domain = ? LIMIT 2').pluck();
const allCompanies = db.prepare('SELECT id, name FROM companies');

// a company whose (loosely compared) name appears in the title — only when exactly one does
function companyInTitle(title: string): string | null {
	const key = titleKey(title);
	const hits = (allCompanies.all() as { id: string; name: string }[]).filter((c) => {
		const k = titleKey(c.name);
		return k.length >= 6 && key.includes(k);
	});
	return hits.length === 1 ? hits[0].id : null;
}

// our own people never decide the client: the signed-in mailbox's domain, plus any others in env
async function internalDomains(): Promise<string[]> {
	const own = (await me()).mail?.split('@')[1] ?? '';
	return [own, ...(env.INTERNAL_EMAIL_DOMAINS ?? '').split(',')].map((d) => d.trim().toLowerCase()).filter(Boolean);
}

const utc = (graphTime: string) => new Date(graphTime.replace(/(\.\d+)?$/, 'Z'));

// the calendar meeting a recording came from: same title (loosely), start nearest the file's creation
async function meetingFor(title: string, createdIso: string): Promise<Meeting | null> {
	const at = Date.parse(createdIso);
	const q = new URLSearchParams({
		startDateTime: new Date(at - MATCH_WINDOW_MS).toISOString(),
		endDateTime: new Date(at + MATCH_WINDOW_MS).toISOString(),
		$select: 'subject,start,attendees,onlineMeeting',
		$top: '50'
	});
	const r = await graph<{ value: Meeting[] }>(`/me/calendarView?${q}`, { headers: { Prefer: 'outlook.timezone="UTC"' } });
	const key = titleKey(title);
	const gap = (m: Meeting) => Math.abs(utc(m.start.dateTime).getTime() - at);
	return r.value.filter((m) => titleKey(m.subject ?? '') === key).sort((a, b) => gap(a) - gap(b))[0] ?? null;
}

async function noteFor(item: Item): Promise<void> {
	const title = recordingTitle(item.name);
	const meeting = await meetingFor(title, item.createdDateTime); // none for a Meet-now call
	const people = (meeting?.attendees ?? []).flatMap((a) =>
		a.emailAddress?.address ? [{ name: a.emailAddress.name || a.emailAddress.address, mail: a.emailAddress.address }] : []
	);
	const company = meetingCompany(people.map((p) => p.mail), meeting?.subject ?? title, await internalDomains(), {
		byEmail: (email) => (contactCompany.get(email) as string | undefined) ?? null,
		byDomain: (domain) => {
			const ids = domainCompanies.all(domain) as string[];
			return ids.length === 1 ? ids[0] : null;
		},
		byTitle: companyInTitle
	});
	// a matched client without a folder gets one, the same as for a new ticket
	if (company) ensureClientFolders([company]);
	const folder = (company && folderForCompany(company, null)) || createFolder('', UNCLASSIFIED);
	const start = meeting ? utc(meeting.start.dateTime) : new Date(item.createdDateTime);
	const body = recordingNote({
		start,
		minutes: item.video?.duration ? Math.round(item.video.duration / 60_000) : null,
		attendees: people.map((p) => p.name),
		video: recordingSrc(item.id),
		link: item.webUrl
	});
	// a Meet-now call has no scheduled meeting to ask for a transcript: say so now rather than never
	const joinUrl = meeting?.onlineMeeting?.joinUrl ?? null;
	const file = createNote(folder, `Recording - ${meeting?.subject ?? title}`, joinUrl ? body : `${body}\n${transcriptSection(null)}`, ymd(start));
	remember.run(item.id, folder, file, nowIso(), item.createdDateTime, joinUrl, joinUrl ? 'pending' : 'none');
}

// ---- transcripts

type Pending = { item_id: string; folder: string; file: string; created_at: string; recorded_at: string; join_url: string };
const pendingTranscripts = db.prepare("SELECT item_id, folder, file, created_at, recorded_at, join_url FROM recordings WHERE transcript = 'pending'");
const setTranscript = db.prepare('UPDATE recordings SET transcript = ? WHERE item_id = ?');
const lastError = new Map<string, string>(); // item -> the error last logged, so a retry every few minutes logs a change only

// WebVTT, with speaker names when the tenant allows them; otherwise the same text without speakers
async function transcriptText(meetingId: string, transcriptId: string): Promise<string> {
	const path = `/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`;
	let res = await graphRaw(`${path}?$format=text/vtt`, {}, undefined, 30_000);
	if (res.status === 403 && (await res.clone().text()).includes('SpeakerAttributionNotAllowed'))
		res = await graphRaw(path, { headers: { accept: 'application/vnd.microsoft.graph.transcript+text' } }, undefined, 30_000);
	if (!res.ok) throw new Error(`Graph ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
	return res.text();
}

// the transcript of the call a recording came from, or null while Teams doesn't have one yet. A recurring
// series shares one meeting (and join link) across occurrences, so only transcripts begun near this
// recording count.
async function transcriptFor(joinUrl: string, recordedAt: string): Promise<Turn[] | null> {
	const q = new URLSearchParams({ $filter: `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'` });
	const meeting = (await graph<{ value: { id: string }[] }>(`/me/onlineMeetings?${q}`)).value[0];
	if (!meeting) return null;
	const at = Date.parse(recordedAt);
	const list = (await graph<{ value: { id: string; createdDateTime: string }[] }>(`/me/onlineMeetings/${meeting.id}/transcripts`)).value
		.filter((t) => Date.parse(t.createdDateTime) >= at - 3600_000 && Date.parse(t.createdDateTime) <= at + 6 * 3600_000)
		.sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime));
	if (!list.length) return null;
	const turns: Turn[] = [];
	for (const t of list) turns.push(...vttTurns(await transcriptText(meeting.id, t.id)));
	return turns;
}

// append under whatever the note holds now; a note deleted in the meantime just stops being tracked
function addTranscript(r: Pending, turns: Turn[] | null) {
	try {
		writeNote(r.folder, r.file, `${readNote(r.folder, r.file).trimEnd()}\n\n${transcriptSection(turns)}`);
	} catch (e) {
		console.warn('[recordings] transcript not added to', r.file, errMsg(e).slice(0, 160));
	}
	setTranscript.run(turns ? 'done' : 'none', r.item_id);
	lastError.delete(r.item_id);
}

async function syncTranscripts(): Promise<void> {
	for (const r of pendingTranscripts.all() as Pending[]) {
		const gaveUp = Date.now() - Date.parse(r.created_at) > TRANSCRIPT_WAIT_MS;
		try {
			const turns = await transcriptFor(r.join_url, r.recorded_at);
			if (turns || gaveUp) addTranscript(r, turns);
		} catch (e) {
			if (gaveUp) addTranscript(r, null);
			else if (lastError.get(r.item_id) !== errMsg(e)) {
				lastError.set(r.item_id, errMsg(e));
				console.warn('[recordings] transcript not ready for', r.file, errMsg(e).slice(0, 200));
			}
		}
	}
}

/**
 * Where a recording note's player gets the video: a fresh pre-signed download link for the OneDrive item,
 * or null. Only for a video in the Recordings folder — the endpoint is never a way into the rest of the
 * drive. The link needs no cookies (so it plays in any browser) and expires within about an hour.
 */
export async function recordingDownloadUrl(itemId: string): Promise<string | null> {
	if (DEMO() || !teamsConnected() || !recordingSrc(itemId)) return null;
	try {
		// no $select: Graph leaves the download link out of a selected response
		const it = await graph<{ file?: { mimeType?: string }; parentReference?: { path?: string }; '@microsoft.graph.downloadUrl'?: string }>(
			`/me/drive/items/${itemId}`
		);
		const inRecordings = it.parentReference?.path === '/drive/root:/Recordings';
		return inRecordings && it.file?.mimeType?.startsWith('video/') ? (it['@microsoft.graph.downloadUrl'] ?? null) : null;
	} catch {
		return null; // deleted, moved, or not ours
	}
}

/** Poller, every few minutes: a note for each finished recording not yet made into one. */
export async function syncRecordings(): Promise<void> {
	if (DEMO() || !env.NOTES_DIR || !teamsConnected()) return;
	const since = meta.get(SINCE);
	if (!since) return void meta.set(SINCE, nowIso()); // first run: recordings already made stay as they are
	let items: Item[] = [];
	try {
		// a literal query: URLSearchParams writes the space in "desc" as "+", which OData doesn't read as one
		const q = '$top=50&$orderby=lastModifiedDateTime%20desc&$select=id,name,createdDateTime,lastModifiedDateTime,webUrl,file,video';
		items = (await graph<{ value: Item[] }>(`/me/drive/root:/Recordings:/children?${q}`)).value;
	} catch (e) {
		// 404: nothing has been recorded yet, so there's no folder. Pending transcripts still get their turn.
		if (!errMsg(e).includes('Graph 404')) console.warn('[recordings] list skipped:', errMsg(e).slice(0, 200));
	}
	const settled = Date.now() - SETTLE_MS;
	for (const item of items) {
		if (!item.file?.mimeType?.startsWith('video/') || Date.parse(item.createdDateTime) <= Date.parse(since)) continue;
		if (Date.parse(item.lastModifiedDateTime) > settled || taken.get(item.id)) continue;
		try {
			await noteFor(item);
		} catch (e) {
			console.warn('[recordings] no note yet for', item.name, errMsg(e).slice(0, 200)); // retried next run
		}
	}
	await syncTranscripts();
}
