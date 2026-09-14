import { describe, expect, it } from 'vitest';
import { endReason, startError } from './errors';

describe('startError', () => {
	it("strips the SDK's repeated troubleshooting links", () => {
		expect(startError(new Error('Boom, Troubleshooting Guide: https://a.example Troubleshooting Guide: https://b.example'))).toBe('Boom');
	});
	it('maps browser media errors to something actionable', () => {
		expect(startError(new Error('NotAllowedError: Permission denied'))).toMatch(/access was denied/);
		expect(startError(new Error('NotReadableError: device in use'))).toMatch(/in use by another app/);
		expect(startError(new Error('NotFoundError: no device'))).toMatch(/No microphone was found/);
	});
	it('names the camera when the camera was the device in use', () => {
		expect(startError(new Error('NotAllowedError: Permission denied'), 'camera')).toBe('Camera access was denied. Allow it for this site, then try again.');
		expect(startError(new Error('NotReadableError: Could not start video source'), 'camera')).toBe('The camera is in use by another app.');
	});
	it('explains the wrong-origin refusal for the VPS as well as a laptop', () => {
		expect(startError(new Error('ACS Web Calling SDK must be used through https, file:, or localhost'))).toMatch(/https:\/\/ address/);
	});
	it('maps licensing, network and call-state failures', () => {
		expect(startError(new Error('403 Forbidden'))).toMatch(/not licensed/);
		expect(startError(new TypeError('Failed to fetch'))).toBe('No connection to OpsCenter.');
		expect(startError(new Error('Call is not in Connected state'))).toMatch(/once the call has connected/);
	});
	it('passes consent errors through untouched (already written for people)', () => {
		const m = 'AADSTS65001: The user or administrator has not consented';
		expect(startError(new Error(m))).toBe(m);
	});
	it('shows anything unrecognised verbatim', () => {
		expect(startError(new Error('Something specific happened'))).toBe('Something specific happened');
		expect(startError("You're already in a call. Hang up first.")).toBe("You're already in a call. Hang up first.");
	});
});

describe('endReason', () => {
	it('says nothing for a normal hang-up or a decline', () => {
		expect(endReason()).toBeNull();
		expect(endReason(0)).toBeNull();
		expect(endReason(487)).toBeNull();
	});
	it('explains the endings a person can act on', () => {
		expect(endReason(403)).toBe('Tenant policy blocked this call.');
		expect(endReason(404)).toBe("That person couldn't be reached.");
		expect(endReason(490, 10004)).toBe('The call hit the 30-hour limit and ended.');
	});
	it('shows other codes verbatim rather than guessing', () => {
		expect(endReason(500, 12)).toBe('Call ended (500/12).');
		expect(endReason(500)).toBe('Call ended (500/0).');
	});
});
