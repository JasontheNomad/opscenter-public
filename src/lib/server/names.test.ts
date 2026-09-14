import { describe, expect, it } from 'vitest';
import { cleanName, uniqueMatch } from './names';

describe('cleanName', () => {
	it('strips path separators and reserved characters, then trims', () => {
		expect(cleanName('  Doe/Roe: "LLP" * ? <x> | \\ ')).toBe('DoeRoe LLP   x');
	});
	it('leaves ordinary names alone', () => {
		expect(cleanName('Acme Law Group')).toBe('Acme Law Group');
	});
});

describe('uniqueMatch', () => {
	it('matches exactly, ignoring case, spaces and punctuation', () => {
		expect(uniqueMatch('NORTHSTAR / 2-4 PARTNERS LLC', ['Other', 'Northstar  2-4 Partners LLC'])).toBe('Northstar  2-4 Partners LLC');
	});
	it('an exact hit wins over looser ones', () => {
		expect(uniqueMatch('Harbor Legal', ['Harbor', 'Harbor Legal'])).toBe('Harbor Legal');
	});
	it('matches when one name starts the other', () => {
		expect(uniqueMatch('Acme Law Group', ['Acme', 'Zeta Partners'])).toBe('Acme');
		expect(uniqueMatch('Acme', ['Acme Law Group', 'Zeta Partners'])).toBe('Acme Law Group');
	});
	it('refuses an ambiguous level instead of guessing', () => {
		expect(uniqueMatch('Acme Law Group', ['Acme', 'Acme Law'])).toBeNull();
	});
	it('does not fall through to a looser level once a level is ambiguous', () => {
		// two prefix hits; a contains-only hit further down must not be picked instead
		expect(uniqueMatch('Acme Law Group', ['Acme', 'Acme Law', 'The Acme Law Group Archive'])).toBeNull();
	});
	it('needs 4+ characters for a prefix match', () => {
		expect(uniqueMatch('Abc Holdings', ['Abc'])).toBeNull();
	});
	it('matches a name contained in the other at 6+ characters', () => {
		expect(uniqueMatch('The Parkside Firm', ['Parkside', 'Zeta'])).toBe('Parkside');
		expect(uniqueMatch('The Lawco Firm', ['Lawco'])).toBeNull(); // 5 characters: too short to trust
	});
	it('no longer pairs a first word with a longer name (Smith ≠ Smithson)', () => {
		expect(uniqueMatch('Smith & Co', ['Smithson'])).toBeNull();
	});
	it('returns null for an empty name or no candidates', () => {
		expect(uniqueMatch('  ', ['Acme'])).toBeNull();
		expect(uniqueMatch('Acme', [])).toBeNull();
	});
});
