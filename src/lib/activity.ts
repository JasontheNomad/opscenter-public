// A ticket's HubSpot activity, arranged for the panel's two tabs. Pure: no fetches, no Svelte.
import type { Activity, Task } from './types';
import { htmlToText } from './html';

// HubSpot's "Ticket description", plain text or HTML depending on where it was written. On a ticket
// the client opened through the portal it's their opening message, so it lives in the Client Response
// thread; on ours it's shown under the title.
export function descriptionText(description: string | null): string {
	const d = (description ?? '').trim();
	return /<[a-z][\s\S]*>/i.test(d) ? htmlToText(d) : d;
}

// Notes tab: team notes, newest first, directly under the composer.
export const teamNotes = (activity: Activity[]) => activity.filter((a) => a.kind === 'note' && !a.portal).reverse();

type TicketInfo = Pick<Task, 'submitted_via' | 'description' | 'hs_created_at' | 'created_at'>;

// Client tab: portal messages + emails, oldest first like the portal, reply box at the end.
export function clientThread(activity: Activity[], task: TicketInfo): Activity[] {
	const items = activity.filter((a) => a.kind === 'email' || a.portal);
	const body = descriptionText(task.description);
	if (!task.submitted_via || !body) return items;
	// A portal ticket's description is the client's opening message. The portal posts any screenshot
	// as a separate, text-less note moments later — fold that into the same card, the way the portal
	// itself reads.
	const opened = task.hs_created_at ?? task.created_at;
	const near = (a: Activity) => Math.abs(new Date(a.at).getTime() - new Date(opened).getTime()) < 10 * 60_000;
	const textless = (a: Activity) => !a.body.replace(/^Attached:.*$/gm, '').trim();
	const folded = items.filter((a) => a.portal && a.attachments.length && textless(a) && near(a));
	const request: Activity = {
		id: 'request', kind: 'request', at: opened, author: 'Client (portal)', portal: true,
		body, attachments: folded.flatMap((a) => a.attachments)
	};
	return [...items.filter((a) => !folded.includes(a)), request].sort((a, b) => a.at.localeCompare(b.at));
}
