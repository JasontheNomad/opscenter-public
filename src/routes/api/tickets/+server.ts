import { json, error } from '@sveltejs/kit';
import { nowIso } from '$lib/dates';
import { createTicket, associateTicketContact, recordUrl } from '$lib/server/hubspot';
import { syncAll, dropChange, stageStatus, insertMirror, firstStage } from '$lib/server/sync';
import { getTask, markSeen } from '$lib/server/tasks';
import { PROJECT_PIPELINE_LABEL, SUPPORT_PIPELINE_LABEL } from '$lib/views';
import { need, readBody } from '$lib/server/http';
import { HS_PRIORITY, isPriority } from '$lib/priority';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/api';

// { title, view: 'support' | 'projects', company_id?, contact_id?, priority?, description? }
// -> HubSpot ticket in that pipeline's first stage. The mirror row is inserted directly (HubSpot search
// is eventually consistent, so a sync right after create usually can't see the new ticket yet).
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	const title = need(body.title, 'title').trim();
	const label = body.view === 'projects' ? PROJECT_PIPELINE_LABEL : SUPPORT_PIPELINE_LABEL;
	const first = firstStage(label);
	if (!first) error(503, `no stages cached for ${label} — run Sync first`);
	const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
	const company = str(body.company_id);
	const contact = str(body.contact_id);
	const priorityN = isPriority(body.priority) ? body.priority : 0;
	const description = str(body.description);

	let id: string;
	let updatedAt: string | undefined;
	try {
		({ id, updatedAt } = await createTicket({ subject: title, pipeline: first.pipeline_id, stage: first.stage_id, priority: HS_PRIORITY[priorityN] ?? null, content: description }, company));
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 502 });
	}
	// The ticket exists from here on. A failed contact link must not fail the request: a 502 read as
	// "not created" and a retry made a duplicate ticket.
	let warning: string | undefined;
	if (contact) {
		try {
			await associateTicketContact(id, contact);
		} catch (e) {
			warning = `Ticket created, but linking the contact failed: ${errMsg(e)}`;
		}
	}

	// local mirror now; marked seen so our own ticket doesn't bubble/notify
	const localId = insertMirror(
		{ hs_id: id, title, description: description ?? '', hs_created_at: nowIso(), submitted_via: null, priority: priorityN, hs_pipeline: first.pipeline_id, hs_stage: first.stage_id, hs_modified_at: updatedAt ?? null, hs_url: recordUrl('0-5', id), company_id: company },
		'ticket',
		stageStatus('ticket', first.stage_id),
		nowIso()
	);
	// best-effort refresh (fills hs_modified_at etc. once search catches up); never fails the request
	try {
		await syncAll();
		dropChange(localId);
		markSeen(localId);
	} catch {}
	return json({ ...getTask(localId), warning }, { status: 201 });
};
