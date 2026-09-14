// @mention autocomplete for a plain textarea composer. The draft keeps "@Name" as text; the people picked
// ride beside it (take() at send) and the server tags them.
import { mentionQuery, mentionsIn, type Person } from './mentions';

export class MentionPicker {
	items = $state<Person[]>([]);
	index = $state(0);
	#source: (q: string) => Person[] | Promise<Person[]>;
	#delay: () => number; // ms to wait before asking the source — a directory search per keystroke is wasteful
	#at = -1;
	#seq = 0;
	#picked: Person[] = [];

	constructor(source: (q: string) => Person[] | Promise<Person[]>, delay: () => number = () => 0) {
		this.#source = source;
		this.#delay = delay;
	}

	/** On input: open, filter or close the list for the `@query` before the caret. */
	async update(el: HTMLTextAreaElement) {
		const seq = ++this.#seq;
		const hit = mentionQuery(el.value.slice(0, el.selectionStart));
		// text typed after a finished mention ("@Ann Lee thanks") is not a new query
		if (!hit || this.#picked.some((p) => hit.q.startsWith(`${p.name} `))) return this.#clear();
		const wait = this.#delay();
		if (wait) await new Promise((r) => setTimeout(r, wait));
		if (seq !== this.#seq) return;
		let items: Person[];
		try {
			items = await this.#source(hit.q);
		} catch {
			items = [];
		}
		if (seq !== this.#seq) return; // typed on meanwhile
		this.#at = hit.at;
		this.items = items;
		this.index = 0;
	}

	close() {
		this.#seq++;
		this.#clear();
	}
	#clear() {
		this.items = [];
		this.#at = -1;
	}

	/** Arrows, Enter/Tab and Escape while the list is open. True when the key was used. */
	key(e: KeyboardEvent, el: HTMLTextAreaElement, set: (v: string) => void): boolean {
		const n = this.items.length;
		if (!n) return false;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') this.index = (this.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
		else if (e.key === 'Enter' || e.key === 'Tab') this.pick(this.items[this.index], el, set);
		else if (e.key === 'Escape') this.close();
		else return false;
		e.preventDefault();
		return true;
	}

	/** Replace the `@query` with "@Name " and remember who it was. */
	pick(p: Person, el: HTMLTextAreaElement, set: (v: string) => void) {
		if (this.#at < 0) return;
		const insert = `@${p.name} `;
		const pos = this.#at + insert.length;
		set(el.value.slice(0, this.#at) + insert + el.value.slice(el.selectionStart));
		if (!this.#picked.some((x) => x.id === p.id)) this.#picked.push(p);
		this.close();
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(pos, pos);
		});
	}

	/** The picked people still named in `text`, for the send. Forgets them. */
	take(text: string): Person[] {
		const people = mentionsIn(text, this.#picked);
		this.#picked = [];
		return people;
	}
	/** A failed send gave the draft back — keep its mentions with it. */
	keep(people: Person[]) {
		this.#picked = [...people];
	}
}
