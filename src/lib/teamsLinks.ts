// Open a Teams deep link. The server used to shell out to Brave --app=… for a chromeless window, which
// only ever worked when the server *was* your Mac; on the VPS it has no desktop, so this is a plain
// popup now (E63). The whole hand-off goes away in Phase 8.
export function openTeamsWindow(url: string, name = 'teams-call') {
	window.open(url, name, 'popup,width=1280,height=800');
}

// Rings the people directly in the Teams desktop app (the web /l/call link only lands you in the
// full web client with a "Start call?" prompt).
export const callUrl = (emails: string[], video = false) =>
	`msteams:/l/call/0/0?users=${encodeURIComponent(emails.join(','))}${video ? '&withVideo=true' : ''}`;
