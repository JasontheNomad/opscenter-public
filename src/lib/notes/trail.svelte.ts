// The notes opened in the page, in order, so ← → move back and forth between them — into a
// wiki-linked note and back out again. Lives outside the page so a detour to a ticket keeps it.
// Opening a note while somewhere in the middle drops what was ahead, as browser history does.
export type Stop = { client: string; file: string };

class Trail {
	#stops = $state<Stop[]>([]);
	#at = $state(-1);

	get canBack() { return this.#at > 0; }
	get canForward() { return this.#at < this.#stops.length - 1; }

	/** The page shows this note now: record it, unless it's the stop we just moved to (or are on). */
	visit(s: Stop) {
		const cur = this.#stops[this.#at];
		if (cur && cur.client === s.client && cur.file === s.file) return;
		this.#stops = [...this.#stops.slice(0, this.#at + 1), s];
		this.#at = this.#stops.length - 1;
	}
	/** The stop one step back or forward, moving there; null at either end. */
	step(d: -1 | 1): Stop | null {
		const s = this.#stops[this.#at + d];
		if (s) this.#at += d;
		return s ?? null;
	}
}

export const trail = new Trail();
