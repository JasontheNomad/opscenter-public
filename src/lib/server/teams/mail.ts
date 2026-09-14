// Sending mail exists for exactly one reason: seeding a HubSpot conversation thread (server/seed.ts).
// HubSpot has no API that creates a thread — only an inbound message on a connected channel makes one,
// so the seed has to arrive at the hosted inbox as a real email. Nothing else here sends mail.
import { textToHtml } from '$lib/html';
import { graphRaw } from './graph';

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
	const res = await graphRaw(
		'/me/sendMail',
		{
			method: 'POST',
			body: JSON.stringify({
				message: {
					subject,
					// HTML, not Text: quoted-printable wraps a plain-text body at 76 chars and the soft-break
					// marker survived HubSpot's decode as a stray '=' in the message the client saw
					body: { contentType: 'HTML', content: textToHtml(text) },
					toRecipients: [{ emailAddress: { address: to } }]
				},
				saveToSentItems: true
			})
		},
		undefined,
		20_000
	);
	// 202 Accepted with an empty body, so graph() can't be used here — it would parse the body as JSON
	if (!res.ok) throw new Error(`Graph ${res.status} /me/sendMail: ${(await res.text()).slice(0, 300)}`);
}
