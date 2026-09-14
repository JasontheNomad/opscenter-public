import { redirect } from '@sveltejs/kit';
import { CLIENTS, vaultHref } from '$lib/notes/vault';
import type { RequestHandler } from './$types';

// The Vault page used to be /clients/<client>: old links and bookmarks land on that client's folder.
export const GET: RequestHandler = ({ params, url }) => redirect(308, vaultHref(params.rest ? `${CLIENTS}/${params.rest}` : '') + url.search);
