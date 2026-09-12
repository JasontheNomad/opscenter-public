// Browser-side: File -> { name, type, data(base64), url(data URL), size } for JSON upload + preview.
export type Att = { id: string; name: string; type: string; data: string; url: string; size: number };
// Uploads travel as base64 JSON (+33%), and the server takes 25 MB bodies (BODY_SIZE_LIMIT), so
// 18 MB is the largest file that still fits.
export const MAX_MB = 18;
export const tooBig = (names: string[]) => `over ${MAX_MB} MB: ${names.join(', ')}`;

const readFile = (f: File) =>
	new Promise<Att>((res, rej) => {
		const r = new FileReader();
		r.onload = () => {
			const url = String(r.result);
			res({ id: crypto.randomUUID(), name: f.name || `image-${Date.now()}.png`, type: f.type || 'application/octet-stream', data: url.split(',')[1] ?? '', url, size: f.size });
		};
		r.onerror = rej;
		r.readAsDataURL(f);
	});

// returns read attachments + names of files rejected for size
export async function readFiles(list: FileList | File[] | null | undefined): Promise<{ atts: Att[]; rejected: string[] }> {
	const files = Array.from(list ?? []);
	const ok = files.filter((f) => f.size <= MAX_MB * 1024 * 1024);
	return { atts: await Promise.all(ok.map(readFile)), rejected: files.filter((f) => !ok.includes(f)).map((f) => f.name) };
}

export const pastedFiles = (e: ClipboardEvent) =>
	Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()!).filter(Boolean);

export const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const isImage = (a: { type: string }) => a.type.startsWith('image/');
// what the server expects (drops the preview data URL)
export const payload = ({ name, type, data }: Att) => ({ name, type, data });
// markdown for a saved file: image embed or plain link
export const mdLink = (name: string, url: string) => (/\.(png|jpe?g|gif|webp|svg)$/i.test(url) || /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? `![${name}](${url})` : `[${name}](${url})`);
