// One open note in the editor: its text, whether the file holds it yet, and saving it.
import { api, errMsg } from '$lib/api';

// Saves run one at a time, across all notes — two in flight would carry the same base mtime and the
// second would be refused as a conflict with the first. `newest` is the mtime our own last save
// produced, per note: a note reopened before that save landed still loads the older mtime.
let chain: Promise<void> = Promise.resolve();
const newest = new Map<string, string>();

export class NoteSession {
	body = $state('');
	error = $state('');
	// `edits` counts changes and `stored` is the count the file holds, so a save that lands while newer
	// keystrokes still wait can't mark those saved
	#edits = $state(0);
	#stored = $state(0);
	saved = $derived(this.#edits === this.#stored);
	#timer: ReturnType<typeof setTimeout> | undefined;
	readonly client: string;
	readonly file: string;
	readonly #key: string;
	readonly #loadedAt: string | null;

	/** `loadedAt` = the file's mtime when loaded: sent with each save, so a change made elsewhere since is
	 *  refused (409) instead of overwritten. */
	constructor(client: string, file: string, body: string, loadedAt: string | null) {
		this.client = client;
		this.file = file;
		this.body = body;
		this.#key = `${client}/${file}`;
		this.#loadedAt = loadedAt;
	}

	edit(v: string) {
		this.body = v;
		this.#edits++;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.save(), 800);
	}

	/** Queue a save of the current text (no-op when saved). `keepalive` lets it finish after the page
	 *  navigates away; browsers cap those bodies at 64 KB, so a longer note saves without it. */
	save({ keepalive = false } = {}): Promise<void> {
		clearTimeout(this.#timer);
		if (this.saved) return chain;
		const n = this.#edits;
		const body = this.body;
		chain = chain.then(() => this.#put(n, body, keepalive && body.length < 60_000));
		return chain;
	}

	async #put(n: number, body: string, keepalive: boolean) {
		const ours = newest.get(this.#key);
		const loaded = this.#loadedAt;
		const base = !loaded ? (ours ?? null) : ours && ours > loaded ? ours : loaded;
		try {
			const r = await api<{ mtime: string }>('/api/notes', 'PUT', { client: this.client, file: this.file, body, base }, { keepalive });
			newest.set(this.#key, r.mtime);
			this.#stored = Math.max(this.#stored, n);
			this.error = '';
		} catch (e) {
			this.error = errMsg(e);
		}
	}
}
