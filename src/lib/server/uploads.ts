// Client-sent file uploads: validation + mime lookup.
import type { Upload } from '$lib/types';

const MAX = 10;

// validate a client-sent uploads array ({name, type, data(base64)}[])
export const pickUploads = (v: unknown): Upload[] =>
	Array.isArray(v)
		? v
				.filter((u) => u && typeof u.name === 'string' && typeof u.data === 'string')
				.slice(0, MAX)
				.map((u) => ({ name: safeName(u.name), type: typeof u.type === 'string' ? u.type : 'application/octet-stream', data: u.data }))
		: [];

const safeName = (n: string) => n.replace(/[^\w.() -]+/g, '_').slice(0, 120) || 'file';

export const mimeOf = (file: string) =>
	({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' })[
		file.split('.').pop()?.toLowerCase() ?? ''
	] ?? 'application/octet-stream';
