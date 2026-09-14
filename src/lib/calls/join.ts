// Joining a Teams meeting from anywhere in the app — calendar Join, Meet now in the calendar and in a
// channel. In-app when the call engine runs; otherwise, or if it fails, the Teams hand-off
// (CALLS_ENGINE=deeplink). Phase 8 of docs/acs-calling-sow.md deletes the hand-off branch.
import { post } from '$lib/api';
import { openTeamsWindow } from '$lib/teamsLinks';
import { calls } from './engine.svelte';

export async function joinMeeting(url: string, title = 'Meet now', sub = '') {
	try {
		if (await calls.inApp()) {
			calls.prepare(title, (o) => calls.join(url, o.video), undefined, sub);
			return;
		}
	} catch {
		/* an engine that can't start degrades to the hand-off rather than a dead button */
	}
	calls.noteHandoff();
	openTeamsWindow(url, 'teams-meeting');
}

/** Start an instant meeting and join it. Throws if the meeting can't be created. */
export async function meetNow() {
	const { joinUrl } = await post<{ joinUrl: string }>('/api/calendar/meetnow');
	await joinMeeting(joinUrl);
}
