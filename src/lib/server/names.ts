// Client / company names: filesystem-safe folder names and the one matcher between vault folders and
// HubSpot companies. Pure — no disk, no DB — so it's unit-tested (names.test.ts).

/** Filesystem-safe name: no path separators or reserved characters. */
export const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();

/** Loose matching key for folder ↔ company names. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Pair a name with exactly one of `candidates` (company ↔ vault folder), loosest last: exact, then one a
 * prefix of the other (shorter ≥ 4 chars: "Acme" ↔ "Acme Law Group"), then one inside the other
 * (shorter ≥ 6). The first level with any hit decides; two or more hits there means null. These are
 * law-firm notes — showing one client's notes on another's ticket is worse than showing none.
 */
export function uniqueMatch(name: string, candidates: string[]): string | null {
	const t = norm(name);
	if (!t) return null;
	const short = (n: string) => Math.min(n.length, t.length);
	const levels: ((n: string) => boolean)[] = [
		(n) => n === t,
		(n) => short(n) >= 4 && (n.startsWith(t) || t.startsWith(n)),
		(n) => short(n) >= 6 && (n.includes(t) || t.includes(n))
	];
	const keys = candidates.map(norm);
	for (const fits of levels) {
		const hits = candidates.filter((_, i) => fits(keys[i]));
		if (hits.length) return hits.length === 1 ? hits[0] : null;
	}
	return null;
}
