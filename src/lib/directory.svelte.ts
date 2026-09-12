// Companies + contacts for the pickers, fetched once in the background and reused across board switches.
// They change rarely (synced from HubSpot), so a 10-minute-old copy is fine; the pickers show what's
// loaded and fill in when the fetch lands.
import { api } from '$lib/api';
import type { Company, Contact } from '$lib/types';

const FRESH_MS = 10 * 60_000;

class Directory {
	companies = $state.raw<Company[]>([]);
	contacts = $state.raw<Contact[]>([]);
	#at = 0;
	#inflight: Promise<void> | null = null;

	/** Fetch unless a fresh copy is loaded or on its way. Never throws: a failure leaves the old lists. */
	load(): Promise<void> {
		if (this.#inflight) return this.#inflight;
		if (Date.now() - this.#at < FRESH_MS) return Promise.resolve();
		this.#inflight = api<{ companies: Company[]; contacts: Contact[] }>('/api/directory')
			.then((d) => {
				this.companies = d.companies;
				this.contacts = d.contacts;
				this.#at = Date.now();
			})
			.catch(() => {})
			.finally(() => (this.#inflight = null));
		return this.#inflight;
	}
}

export const directory = new Directory();
