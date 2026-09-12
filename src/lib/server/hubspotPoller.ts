// Background HubSpot sync (90s) so bubbles/notifications work on any page or with the PWA closed.
import { syncAll, takeChanges } from './sync';
import { seedThreads } from './seed';
import { DEMO } from './demo';

let started = false;

export function startHubspotPoller(intervalMs = 90_000) {
	if (started) return;
	started = true;
	if (DEMO()) return;
	const tick = async () => {
		try {
			await syncAll();
		} catch {
			return; // recorded (and logged once) in syncHealth; shows in the board header
		}
		// drained so the buffer can't grow forever. Nothing consumes it now that the native banner is
		// gone (E63): the board's own change flags drive bubbles, and the PWA raises its own alerts.
		takeChanges();
		// new portal tickets need a conversation thread before they can be answered from the app
		try {
			await seedThreads();
		} catch (e) {
			console.error('[seed] tick failed', e);
		}
	};
	setTimeout(tick, 5_000);
	setInterval(tick, intervalMs);
}
