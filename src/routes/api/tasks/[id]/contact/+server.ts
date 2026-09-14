import { associateTicketContact } from '$lib/server/hubspot';
import { need, ticketTask, upstream, readBody } from '$lib/server/http';
import type { RequestHandler } from './$types';

// Attach a HubSpot contact to this ticket (the "To" for client replies).
export const POST: RequestHandler = async ({ params, request }) => {
	const task = ticketTask(params.id);
	const contactId = need((await readBody(request)).contact_id, 'contact_id');
	return upstream(() => associateTicketContact(task.hs_id, contactId));
};
