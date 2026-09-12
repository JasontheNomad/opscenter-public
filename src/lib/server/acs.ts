// Azure Communication Services — Custom Teams Endpoint (CTE) tokens.
// Phase 1 of docs/acs-calling-sow.md: the browser Calling SDK runs on a CTE token, and minting one
// is signed with the ACS resource key, so the exchange can only happen here. The browser never sees
// the connection string, only the short-lived token this returns.
import { env } from '$env/dynamic/private';
import { CommunicationIdentityClient } from '@azure/communication-identity';
import { meta } from './db';
import { cfg, me, onLogout, resourceToken } from './teams';
import { errMsg } from '$lib/api';

// ACS is its own Entra resource. These never go in the sign-in scope list — see resourceToken().
const ACS_SCOPES = [
	'https://auth.msft.communication.azure.com/Teams.ManageCalls',
	'https://auth.msft.communication.azure.com/Teams.ManageChats'
].join(' ');

const CACHE_KEY = 'acs_cte_token';
const REFRESH_AT = 0.8; // mint a new token once 80% of its life is gone, never mid-call on a failure

export type CteToken = { token: string; expiresOn: string; userId: string };
type Cached = CteToken & { mintedAt: number };

export const acsConfigured = () => !!env.ACS_CONNECTION_STRING;

const fresh = (c: Cached) => {
	const life = Date.parse(c.expiresOn) - c.mintedAt;
	return life > 0 && Date.now() - c.mintedAt < life * REFRESH_AT;
};

// Plain-language errors: each of these means a different fix, and "500" means none of them.
function explain(e: unknown): Error {
	const s = errMsg(e);
	// order matters: AAD reports a missing consent as `invalid_grant` too, so test for it first
	if (/AADSTS65001|AADSTS650057|consent|invalid_scope|invalid_resource/i.test(s))
		return new Error('ACS permissions not consented — run prerequisites P3-P5 in docs/acs-calling-sow.md');
	if (/invalid_grant|interaction_required|not connected/i.test(s))
		return new Error('Teams sign-in expired — sign out and back in at /teams');
	if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo/i.test(s))
		return new Error('ACS resource unreachable — check ACS_CONNECTION_STRING and the network');
	if (/license|401|403|Forbidden|Unauthorized/i.test(s))
		return new Error(`ACS rejected the exchange (no Teams Phone/calling license, or the tenant blocks CTE): ${s}`);
	return new Error(`ACS token exchange failed: ${s}`);
}

// Cached CTE token for the Calling SDK. Callers just await this every time; the cache and the 80%
// refresh live here so no call site has to think about expiry.
export async function cteToken(): Promise<CteToken> {
	if (!acsConfigured()) throw new Error('ACS_CONNECTION_STRING not set — run prerequisites P1-P2 in docs/acs-calling-sow.md');
	// me() is memoized for an hour and cleared on logout, so this is free and also catches a cache
	// left behind by a previous sign-in.
	const my = await me().catch((e) => { throw explain(e); });
	const cached = meta.json<Cached | null>(CACHE_KEY, null);
	if (cached && cached.userId === `8:orgid:${my.id}` && fresh(cached))
		return { token: cached.token, expiresOn: cached.expiresOn, userId: cached.userId };

	try {
		const aad = await resourceToken(ACS_SCOPES);
		const client = new CommunicationIdentityClient(env.ACS_CONNECTION_STRING as string);
		const r = await client.getTokenForTeamsUser({
			teamsUserAadToken: aad,
			clientId: cfg().client,
			userObjectId: my.id // Graph /me id is the Entra object id CTE wants
		});
		const out: CteToken = {
			token: r.token,
			expiresOn: new Date(r.expiresOn).toISOString(),
			userId: `8:orgid:${my.id}` // the caller's MRI, so the UI can pick itself out of a roster
		};
		meta.setJson(CACHE_KEY, { ...out, mintedAt: Date.now() } satisfies Cached);
		return out;
	} catch (e) {
		throw explain(e);
	}
}

const clearCteToken = () => meta.del(CACHE_KEY);
// a cached calling token must not outlive the Teams session it was minted from
onLogout(clearCteToken);
