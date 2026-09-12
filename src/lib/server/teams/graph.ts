// Graph HTTP client (delegated or app token), 429 back-off, /me cache.
import { HOUR } from './shared';
import { fetchRetry } from '../fetchRetry';
import { DEMO, demoMe } from '../demo';
import { accessToken, onLogout } from './auth';
import { fileResponse } from '../fileResponse';

// ---- Graph client
const GRAPH = 'https://graph.microsoft.com/v1.0';
// raw Graph fetch: bearer (delegated by default, or an explicit app token), 429 back-off, no body parsing.
// No timeout by default — streamed file downloads come through here; JSON callers pass one (graph()).
export const graphRaw = async (path: string, init: RequestInit = {}, token?: string, timeoutMs?: number) =>
	fetchRetry(path.startsWith('http') ? path : GRAPH + path, {
		...init,
		headers: { authorization: `Bearer ${token ?? (await accessToken())}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) }
	}, { timeoutMs });
export async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await graphRaw(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } }, undefined, 20_000);
	if (!res.ok) throw new Error(`Graph ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
	return res.status === 204 ? (undefined as T) : res.json();
}
// The name to save a download under: SharePoint's own content-disposition when it sends one, else
// whatever the caller worked out. Without it every Teams file download landed as "file" or "content".
const upstreamName = (res: Response): string => {
	const cd = res.headers.get('content-disposition') ?? '';
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
	const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? '';
	if (!encoded) return plain;
	try { return decodeURIComponent(encoded); } catch { return plain; }
};

// pass an upstream body through to the browser (inline images, shared files). Anyone in a chat can send
// a file, so the upstream type is untrusted — fileResponse decides what may render.
export const streamed = (res: Response, name?: string) =>
	fileResponse(res.body, res.headers.get('content-type'), upstreamName(res) || (name ?? ''));

export type Me = { id: string; displayName: string; mail: string };
let meCache: { at: number; v: Me } | null = null;
export async function me(): Promise<Me> {
	if (DEMO()) return demoMe;
	if (meCache && Date.now() - meCache.at < HOUR) return meCache.v;
	const v = await graph<Me>('/me?$select=id,displayName,mail');
	meCache = { at: Date.now(), v };
	return v;
}
onLogout(() => (meCache = null));
