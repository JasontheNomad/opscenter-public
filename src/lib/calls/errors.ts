// Call failures in plain language. Pure, so it's unit-tested (errors.test.ts).
import { errMsg } from '$lib/api';

/**
 * Turn SDK and network failures into something a person can act on. Anything unrecognised is passed
 * through rather than flattened into a useless 'something went wrong'.
 */
// `device`: which one the failed action was using — camera errors used to be reported as the microphone.
export function startError(e: unknown, device: 'mic' | 'camera' = 'mic'): string {
	// the SDK appends its troubleshooting link once per layer it passed through
	const m = errMsg(e).replace(/,?\s*Troubleshooting Guide: \S+/g, '').trim();
	const name = device === 'camera' ? 'camera' : 'microphone';
	if (/not in Connected state/i.test(m)) return 'That only works once the call has connected.';
	if (/must be used through https/i.test(m)) return 'Calling needs OpsCenter opened at its https:// address (or http://localhost:3000 on a laptop).';
	if (/NotAllowedError|Permission denied|permission/i.test(m)) return `${name[0].toUpperCase()}${name.slice(1)} access was denied. Allow it for this site, then try again.`;
	if (/NotReadableError|in use|busy/i.test(m)) return `The ${name} is in use by another app.`;
	if (/NotFoundError|no device/i.test(m)) return `No ${name} was found.`;
	if (/consent|AADSTS/i.test(m)) return m; // already plain, written by acs.ts
	if (/license|403|Forbidden/i.test(m)) return 'Your account is not licensed for Teams calling, or tenant policy blocks it.';
	if (/Failed to fetch|NetworkError|offline/i.test(m)) return 'No connection to OpsCenter.';
	return m;
}

/**
 * Plain language for the handful of endings a user can act on. Everything else is either a normal
 * hangup or a code better shown verbatim than mistranslated.
 */
export function endReason(code?: number, sub?: number): string | null {
	if (!code) return null;
	if (code === 487) return null; // cancelled or declined — not a fault
	if (code === 403) return 'Tenant policy blocked this call.';
	if (code === 404) return "That person couldn't be reached.";
	// the service caps one call at 30 hours and ends it; say so rather than showing a raw code
	if (sub === 10004 || sub === 560000) return 'The call hit the 30-hour limit and ended.';
	return `Call ended (${code}/${sub ?? 0}).`;
}
