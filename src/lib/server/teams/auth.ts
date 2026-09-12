// Delegated auth: PKCE public client, tokens in `meta`, refresh.
import { env } from '$env/dynamic/private';
import { meta } from '../db';
import crypto from 'node:crypto';
import { DEMO } from '../demo';

const SCOPES = [
	'openid', 'profile', 'offline_access', 'User.Read',
	'Chat.ReadWrite', 'ChannelMessage.Send', 'Presence.Read', 'Presence.Read.All', 'Presence.ReadWrite', 'Files.ReadWrite.All', 'User.ReadBasic.All', 'Calendars.ReadWrite', 'OnlineMeetings.ReadWrite', 'People.Read',
	'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All',
	// editing / soft-deleting a channel post (chats need only Chat.ReadWrite). Group.ReadWrite.All is
	// what Graph's chatMessage update requires for channels; both may need admin consent, like
	// ChannelMessage.Read.All. Adding a scope forces a Teams sign-out/sign-in.
	'ChannelMessage.ReadWrite', 'Group.ReadWrite.All',
	'Mail.Send' // seeding a HubSpot conversation thread (server/seed.ts) — the only mail this app sends
].join(' ');

export const cfg = () => {
	if (!env.TEAMS_CLIENT_ID || !env.TEAMS_TENANT_ID) throw new Error('TEAMS_CLIENT_ID / TEAMS_TENANT_ID not set');
	return {
		client: env.TEAMS_CLIENT_ID,
		authority: `https://login.microsoftonline.com/${env.TEAMS_TENANT_ID}/oauth2/v2.0`,
		redirect: env.TEAMS_REDIRECT_URI ?? 'http://localhost:3000/auth/teams/callback'
	};
};


type Tokens = { access_token: string; refresh_token: string; expires_at: number };
// Held in memory, written through to `meta`: every Graph call asks for the token, and re-parsing it from
// SQLite each time was pure overhead. `undefined` = not read from the DB yet.
let tokens: Tokens | null | undefined;
const loadTokens = () => (tokens === undefined ? (tokens = meta.json<Tokens | null>('teams_tokens', null)) : tokens);
const storeTokens = (t: Tokens | null) => {
	tokens = t;
	if (t) meta.setJson('teams_tokens', t);
	else meta.del('teams_tokens');
};
const saveTokens = (t: { access_token: string; refresh_token?: string; expires_in: number }, prevRefresh?: string) =>
	storeTokens({
		access_token: t.access_token,
		refresh_token: t.refresh_token ?? prevRefresh ?? '',
		expires_at: Date.now() + (t.expires_in - 60) * 1000
	});

const saveRefresh = (rt: string) => {
	const t = loadTokens();
	if (t && rt && rt !== t.refresh_token) storeTokens({ ...t, refresh_token: rt });
};

export const teamsConfigured = () => DEMO() || !!(env.TEAMS_CLIENT_ID && env.TEAMS_TENANT_ID);
export const teamsConnected = () => DEMO() || !!loadTokens();
// modules with caches register here; logout clears tokens then runs them
const logoutHooks: (() => void)[] = [];
export const onLogout = (fn: () => void) => { logoutHooks.push(fn); };
export const teamsLogout = () => {
	storeTokens(null);
	for (const h of logoutHooks) h();
};
const loginHooks: (() => void)[] = [];
export const onLogin = (fn: () => void) => { loginHooks.push(fn); };

// ---- PKCE auth code flow
export function authStartUrl(): string {
	const { client, authority, redirect } = cfg();
	const verifier = crypto.randomBytes(48).toString('base64url');
	const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
	const state = crypto.randomBytes(16).toString('hex');
	meta.setJson('teams_pkce', { verifier, state });
	const q = new URLSearchParams({
		client_id: client, response_type: 'code', redirect_uri: redirect, response_mode: 'query',
		scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
	});
	return `${authority}/authorize?${q}`;
}

export async function authCallback(code: string, state: string) {
	const { client, authority, redirect } = cfg();
	const pk = meta.json<{ verifier?: string; state?: string }>('teams_pkce', {});
	if (!pk.verifier || pk.state !== state) throw new Error('PKCE state mismatch');
	const res = await fetch(`${authority}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: client, grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: pk.verifier, scope: SCOPES })
	});
	const j = await res.json();
	if (!res.ok) throw new Error(`token: ${j.error_description ?? res.status}`);
	saveTokens(j);
	meta.del('teams_pkce');
	for (const h of loginHooks) h();
}

// One refresh at a time: at expiry every concurrent Graph call (per-team fetches, five avatars at once)
// used to POST /token on its own, and the last one to finish won.
let refreshing: Promise<string> | null = null;
export async function accessToken(): Promise<string> {
	const t = loadTokens();
	if (!t) throw new Error('Teams not connected');
	if (Date.now() < t.expires_at) return t.access_token;
	return (refreshing ??= refresh(t).finally(() => (refreshing = null)));
}
async function refresh(t: Tokens): Promise<string> {
	const { client, authority } = cfg();
	const res = await fetch(`${authority}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: client, grant_type: 'refresh_token', refresh_token: t.refresh_token, scope: SCOPES })
	});
	const j = await res.json().catch(() => ({}));
	if (!res.ok) {
		// only a dead refresh token forces re-sign-in; 429/5xx/transient AAD errors keep the session
		if (j.error === 'invalid_grant' || j.error === 'interaction_required') teamsLogout();
		throw new Error(`refresh: ${j.error_description ?? res.status}`);
	}
	saveTokens(j, t.refresh_token);
	return j.access_token;
}

// Entra access tokens are single-resource: the Graph token can't also carry ACS scopes, and AAD v2
// rejects a request that mixes resources. Refresh tokens are NOT resource-bound, so trade ours for a
// token audienced wherever we need — no second sign-in, no second app registration.
// Consent still has to exist for the scopes (see prerequisite P5 in docs/acs-calling-sow.md).
export async function resourceToken(scope: string): Promise<string> {
	const t = loadTokens();
	if (!t?.refresh_token) throw new Error('Teams not connected');
	const { client, authority } = cfg();
	const res = await fetch(`${authority}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: client, grant_type: 'refresh_token', refresh_token: t.refresh_token, scope })
	});
	const j = await res.json().catch(() => ({}));
	// Never log out from here. AAD answers a missing *consent* for another resource with the same
	// `invalid_grant` it uses for a dead refresh token, so treating it as death would sign the user
	// out of Teams over a permissions gap. Only the Graph path (accessToken) may end the session.
	if (!res.ok) throw new Error(`${j.error ?? res.status}: ${j.error_description ?? 'token request failed'}`);
	saveRefresh(j.refresh_token);
	return j.access_token as string;
}
