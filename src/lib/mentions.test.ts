import { describe, expect, it } from 'vitest';
import { matchPeople, mentionQuery, mentionsIn } from './mentions';
import { applyMentions, pickMentions } from './server/teams/render';

const ANN = { id: '11111111-1111-1111-1111-111111111111', name: 'Ann Lee' };
const ANNA = { id: '22222222-2222-2222-2222-222222222222', name: 'Anna Cruz' };

describe('mentionQuery', () => {
	it('finds the @query before the caret', () => {
		expect(mentionQuery('hi @an')).toEqual({ at: 3, q: 'an' });
		expect(mentionQuery('@')).toEqual({ at: 0, q: '' });
		expect(mentionQuery('@Ann Le')).toEqual({ at: 0, q: 'Ann Le' });
	});
	it('ignores emails, "@ " and long runs of words', () => {
		expect(mentionQuery('mail jo@example')).toBeNull();
		expect(mentionQuery('hi @ there')).toBeNull();
		expect(mentionQuery('@Ann said we should go')).toBeNull();
	});
});

describe('matchPeople', () => {
	it('matches the start of the name or of any word', () => {
		expect(matchPeople([ANN, ANNA], 'lee')).toEqual([ANN]);
		expect(matchPeople([ANN, ANNA], 'ann')).toEqual([ANN, ANNA]);
		expect(matchPeople([ANN, ANNA], '')).toEqual([ANN, ANNA]);
		expect(matchPeople([ANN, ANNA], 'ee')).toEqual([]);
	});
});

describe('mentionsIn', () => {
	it('drops people whose @Name was deleted', () => {
		expect(mentionsIn('hey @Ann Lee', [ANN, ANNA])).toEqual([ANN]);
	});
});

describe('pickMentions', () => {
	it('keeps only an Entra id with a name', () => {
		expect(pickMentions([ANN, { id: 'nope', name: 'X' }, { id: ANNA.id }, 'junk'])).toEqual([ANN]);
		expect(pickMentions('junk')).toEqual([]);
	});
});

describe('applyMentions', () => {
	it('tags each @Name and numbers the mentions', () => {
		const r = applyMentions('@Ann Lee and @Anna Cruz, @Ann Lee again', [ANN, ANNA]);
		expect(r.html).toBe('<at id="0">Ann Lee</at> and <at id="1">Anna Cruz</at>, <at id="2">Ann Lee</at> again');
		expect(r.mentions.map((m) => [m.id, m.mentioned.user.id])).toEqual([[0, ANN.id], [1, ANNA.id], [2, ANN.id]]);
		expect(r.mentions[0]).toMatchObject({ mentionText: 'Ann Lee', mentioned: { user: { displayName: 'Ann Lee', userIdentityType: 'aadUser' } } });
	});
	it('prefers the longer name and needs a word end', () => {
		const ann = { id: ANN.id, name: 'Ann' };
		expect(applyMentions('@Anna Cruz', [ann, ANNA]).html).toBe('<at id="0">Anna Cruz</at>');
		expect(applyMentions('@Annie', [ann]).html).toBe('@Annie');
	});
	it('matches names that were HTML-escaped', () => {
		const r = applyMentions('hi @O&#39;Neil', [{ id: ANN.id, name: "O'Neil" }]);
		expect(r.html).toBe('hi <at id="0">O&#39;Neil</at>');
		expect(r.mentions[0].mentionText).toBe("O'Neil");
	});
	it('leaves text alone with no one picked', () => {
		expect(applyMentions('@Ann Lee', [])).toEqual({ html: '@Ann Lee', mentions: [] });
	});
});
