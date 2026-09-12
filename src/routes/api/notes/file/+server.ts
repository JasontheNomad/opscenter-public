import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { attachmentPath } from '$lib/server/notes';
import { mimeOf } from '$lib/server/uploads';
import { fileResponse } from '$lib/server/fileResponse';
import type { RequestHandler } from './$types';

// /api/notes/file?client=X&path=attachments/x.png -> the file from the vault
export const GET: RequestHandler = ({ url }) => {
	const client = url.searchParams.get('client') ?? '';
	const rel = url.searchParams.get('path') ?? '';
	if (!client || !rel) error(400, 'client + path required');
	let p: string | null;
	try {
		p = attachmentPath(client, rel);
	} catch {
		p = null;
	}
	if (!p) error(404, 'not found');
	// streamed: attachments run to 18 MB, and reading one whole into memory held the only CPU meanwhile
	return fileResponse(Readable.toWeb(fs.createReadStream(p)) as ReadableStream, mimeOf(rel), path.basename(rel));
};
