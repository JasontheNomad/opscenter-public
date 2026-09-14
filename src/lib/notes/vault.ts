// Vault folders are paths relative to the vault root ("<clients folder>/Acme/Meetings"). The direct
// subfolders of CLIENTS are client folders — the only ones linked to a HubSpot company. Browser-safe:
// the server's notes.ts and the Vault page share these.
import { env } from '$env/dynamic/public';

/** The top-level folder that holds the client folders. `PUBLIC_CLIENTS_FOLDER` in .env; "Clients" by default. */
export const CLIENTS = env.PUBLIC_CLIENTS_FOLDER || 'Clients';

/** The client name when `folder` is a client folder (`<clients folder>/<client>`), else null. */
export function clientOf(folder: string): string | null {
	const parts = folder.split('/');
	return parts.length === 2 && parts[0] === CLIENTS ? parts[1] : null;
}

/** A folder's own name: its last path part. */
export const leaf = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1);

/** The Vault page for a folder ('' = no folder open), each path part encoded. */
export const vaultHref = (folder = '') => (folder ? `/vault/${folder.split('/').map(encodeURIComponent).join('/')}` : '/vault');
