// Seeds a HubSpot conversation thread for every new portal ticket.
//
// Why this exists: HubSpot has no API that creates a conversation thread — a thread is only born from an
// inbound message on a connected channel. The client portal renders threads, not email engagements, so a
// ticket with no thread cannot be answered from anywhere but HubSpot's own composer. Mailing the hosted
// inbox creates the thread (and, verified, no duplicate ticket), which is then associated to the ticket.
//
// The seed arrives inbound, so the portal shows it in the requester's lane under the sender's name — it
// is written in Jason's voice for that reason, and HubSpot sends the client nothing for it.
//
// One email per ticket, ever: seed_at is claimed with a conditional UPDATE before anything is sent, and
// a claim that fails to find its thread is retried for FIND_WINDOW_MS without resending.
import { env } from '$env/dynamic/private';
import { db } from './db';
import { nowIso } from '$lib/dates';
import { errMsg } from '$lib/api';
import { sendMail, teamsConnected } from './teams';
import { associateThread, findThreadBySubject, ticketThreadId } from './hubspot';

const SEED_TEXT =
	'Hey there! I want you to know that your ticket has been assigned to me. Give me 24 hours to look it over and get back to you.';
const FIND_WINDOW_MS = 30 * 60_000;
const PER_TICK = 3; // the seed is not urgent; a burst of new tickets spreads over a few polls

export const seedTag = (hsId: string) => `[#${hsId}]`;

type Row = { id: number; hs_id: string; title: string; seed_at: string | null };

// portal tickets only: submitted_via is set by the portal on tickets the client opened there, and those
// are the only ones the client is watching
const unseeded = db.prepare(
	`SELECT id, hs_id, title, seed_at FROM tasks
	 WHERE source = 'ticket' AND submitted_via IS NOT NULL AND submitted_via <> ''
	   AND hs_thread_id IS NULL AND seed_at IS NULL AND status <> 'done'
	 ORDER BY id LIMIT ?`
);
// claimed but the thread hasn't shown up yet — mail delivery and HubSpot ingest take a minute. Bounded
// on both sides so the 'baseline' sentinel from migration 4 can never match.
const awaitingThread = db.prepare(
	`SELECT id, hs_id, title, seed_at FROM tasks
	 WHERE source = 'ticket' AND hs_thread_id IS NULL AND seed_at BETWEEN ? AND ?
	 ORDER BY id LIMIT ?`
);
const claim = db.prepare('UPDATE tasks SET seed_at = ? WHERE id = ? AND seed_at IS NULL');
const setThread = db.prepare('UPDATE tasks SET hs_thread_id = ? WHERE id = ?');
// seeded too long ago to still be in flight and still no thread: a reply to these cannot reach the
// client, which is the one failure worth interrupting for
const stuck = db
	.prepare(
		`SELECT COUNT(*) FROM tasks
		 WHERE source = 'ticket' AND hs_thread_id IS NULL
		   AND seed_at IS NOT NULL AND seed_at <> 'baseline' AND seed_at < ?`
	)
	.pluck();

export const seedHealth: { error: string | null; stuck: number } = { error: null, stuck: 0 };

export async function seedThreads(): Promise<void> {
	if (!env.HUBSPOT_INBOX_EMAIL || !teamsConnected()) return; // no transport, nothing to do

	for (const r of unseeded.all(PER_TICK) as Row[]) {
		const at = nowIso();
		if (claim.run(at, r.id).changes !== 1) continue; // another tick got it
		try {
			// a thread may already exist (answered from HubSpot, or the portal grew its own seeding) —
			// adopt it rather than opening a second one
			const existing = await ticketThreadId(r.hs_id);
			if (existing) {
				setThread.run(existing, r.id);
				continue;
			}
			await sendMail(env.HUBSPOT_INBOX_EMAIL, `${r.title} ${seedTag(r.hs_id)}`, SEED_TEXT);
		} catch (e) {
			// the claim stands either way: a client is never mailed twice about one ticket
			seedHealth.error = `seed send failed for ticket ${r.hs_id}: ${errMsg(e)}`;
			console.error('[seed] send failed', r.hs_id, e);
		}
	}

	const since = new Date(Date.now() - FIND_WINDOW_MS).toISOString();
	for (const r of awaitingThread.all(since, nowIso(), PER_TICK) as Row[]) {
		try {
			const threadId = await findThreadBySubject(seedTag(r.hs_id), r.seed_at as string);
			if (!threadId) continue;
			await associateThread(r.hs_id, threadId);
			setThread.run(threadId, r.id);
		} catch (e) {
			seedHealth.error = `seed thread lookup failed for ticket ${r.hs_id}: ${errMsg(e)}`;
			console.error('[seed] attach failed', r.hs_id, e);
		}
	}

	seedHealth.stuck = stuck.get(since) as number;
	if (!seedHealth.stuck) seedHealth.error = null; // nothing is unreachable any more
}
