// Presence: read others, set mine (delegated), app-only keep-alive session.
import { env } from '$env/dynamic/private';
import { meta } from '../db';
import { MIN, chunk } from './shared';
import { cfg, teamsConnected } from './auth';
import { graph, graphRaw, me } from './graph';
import { errMsg } from '$lib/api';

// presence for a set of users (Presence.Read)
export async function presenceFor(ids: string[]): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const part of chunk(ids, 100)) {
		try {
			const r = await graph<{ value: { id: string; availability: string }[] }>('/communications/getPresencesByUserId', { method: 'POST', body: JSON.stringify({ ids: part }) });
			for (const p of r.value) out[p.id] = p.availability;
		} catch {}
	}
	return out;
}
export const setMyPresence = (availability: string, activity: string, hours = 8) =>
	me().then((my) => graph<void>(`/users/${my.id}/presence/setUserPreferredPresence`, { method: 'POST', body: JSON.stringify({ availability, activity, expirationDuration: `PT${hours}H` }) }));

// ---- app-only presence session (keeps you "Available" without the Teams client)
// needs TEAMS_CLIENT_SECRET + application permission Presence.ReadWrite.All (admin consented)
let appTok: { at: number; v: string } | null = null;
async function appToken(): Promise<string | null> {
	if (!env.TEAMS_CLIENT_SECRET) return null;
	if (appTok && Date.now() - appTok.at < 50 * MIN) return appTok.v;
	const { client, authority } = cfg();
	const res = await fetch(`${authority}/token`, {
		method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: client, client_secret: env.TEAMS_CLIENT_SECRET, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' })
	});
	const j = await res.json();
	if (!res.ok) throw new Error(`app token: ${j.error_description ?? res.status}`);
	appTok = { at: Date.now(), v: j.access_token };
	return j.access_token;
}
// Graph accepts different availability/activity pairs per endpoint:
//  - setUserPreferredPresence (delegated): Busy/Busy, DoNotDisturb/DoNotDisturb …
//  - setPresence (app session):            Busy/InACall, DoNotDisturb/Presenting …
export const PREFERRED_ACTIVITY: Record<string, string> = { Available: 'Available', Busy: 'Busy', DoNotDisturb: 'DoNotDisturb', BeRightBack: 'BeRightBack', Away: 'Away', Offline: 'OffWork' };
const SESSION_ACTIVITY: Record<string, string> = { Available: 'Available', Busy: 'InACall', DoNotDisturb: 'Presenting', Away: 'Away', BeRightBack: 'BeRightBack', Offline: 'OffWork' };
export const myPresenceSetting = () => meta.get('teams_presence') ?? 'Available';
export const setPresenceSetting = (a: string) => meta.set('teams_presence', a);
export let presenceSessionError: string | null = null;
// A single failed keep-alive is almost always a wifi blip or a sleeping laptop, and the session
// lasts PT10M anyway — so only complain once it has actually missed twice in a row.
let presenceFails = 0;
const presenceOk = () => { presenceFails = 0; presenceSessionError = null; };
const presenceFailed = (why: string) => {
	presenceFails++;
	console.error(`[presence] keep-alive failed (${presenceFails}): ${why}`);
	presenceSessionError = presenceFails > 1 ? `Presence session: ${why}` : null;
};

// call every ≤5 min; session expires after PT10M. Never throws; false = the session wasn't set (why is in
// presenceSessionError once it repeats).
export async function presenceKeepAlive(): Promise<boolean> {
	if (!teamsConnected()) return true;
	const availability = myPresenceSetting();
	// 'Offline' means the session is deliberately not being kept alive; that isn't a failure
	if (availability === 'Offline') return (presenceOk(), true);
	try {
		const tok = await appToken();
		if (!tok) return (presenceOk(), true); // no client secret configured: app-only presence is simply off
		const my = await me();
		const res = await graphRaw(`/users/${my.id}/presence/setPresence`, {
			method: 'POST',
			body: JSON.stringify({ sessionId: cfg().client, availability, activity: SESSION_ACTIVITY[availability] ?? availability, expirationDuration: 'PT10M' })
		}, tok);
		if (res.ok) return (presenceOk(), true);
		presenceFailed(`setPresence ${res.status}: ${(await res.text()).slice(0, 160)}`);
	} catch (e) {
		// every throw lands here, so a stale message can no longer masquerade as the current failure
		presenceFailed(errMsg(e).slice(0, 160));
	}
	return false;
}
export async function presenceClear() {
	const tok = await appToken().catch(() => null);
	if (!tok) return;
	const my = await me().catch(() => null);
	if (!my) return;
	await graphRaw(`/users/${my.id}/presence/clearPresence`, { method: 'POST', body: JSON.stringify({ sessionId: cfg().client }) }, tok).catch(() => {});
}
