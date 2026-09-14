import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { hiddenMarks, wikiLinks, links, images, tables, videos } from './mdMarks';

describe('videos', () => {
	const srcs = (doc: string, cursor = 0) => {
		const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: EditorSelection.cursor(cursor) });
		return videos(state, 0, doc.length).map((r) => r.src);
	};
	const rec = '/api/recordings/01ABCDEF2GHIJ3KLMN';

	it('shows a recording player off the cursor line', () => {
		expect(srcs(`# Recording\n<video src="${rec}" controls></video>`)).toEqual([rec]);
	});

	it('leaves it as text on the cursor line', () => {
		expect(srcs(`<video src="${rec}" controls></video>`, 3)).toEqual([]);
	});

	it('never plays from anywhere but the recordings endpoint', () => {
		expect(srcs('x\n<video src="https://evil.example/v.mp4" controls></video>')).toEqual([]);
		expect(srcs('x\n<video src="//evil.example/api/recordings/1" controls></video>')).toEqual([]);
		expect(srcs('x\n<video src="/api/files/1" controls></video>')).toEqual([]);
	});
});

// what the reader sees once the hidden ranges are cut out
function visible(doc: string, cursor = 0): string {
	const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: EditorSelection.cursor(cursor) });
	ensureSyntaxTree(state, doc.length, 5000);
	let out = '';
	let at = 0;
	for (const r of hiddenMarks(state, 0, doc.length)) (out += doc.slice(at, r.from)), (at = r.to);
	return out + doc.slice(at);
}

describe('hiddenMarks', () => {
	it('hides heading, emphasis, code and strikethrough marks', () => {
		expect(visible('## Title\n\nsome **bold** and *it* and `code` and ~~gone~~', 0)).toBe('## Title\n\nsome bold and it and code and gone');
	});
	it('shows a link as its text and an autolink as its url, but leaves images whole', () => {
		expect(visible('x\nsee [docs](https://x.y "t") and ![shot](a.png) and <https://z.z>')).toBe('x\nsee docs and ![shot](a.png) and https://z.z');
	});
	it('reduces wiki-links to the note name or the label', () => {
		expect(visible('x\na [[Note One]] b [[Other|the label]] c ![[img.png]]')).toBe('x\na Note One b the label c ![[img.png]]');
	});
	it('keeps every mark on the line the cursor is on', () => {
		const doc = '# One\n**two**\n# Three';
		expect(visible(doc, 7)).toBe('One\n**two**\nThree');
		expect(visible(doc, 0)).toBe('# One\ntwo\nThree');
	});
});

describe('wikiLinks', () => {
	it('marks the visible name or label of each wiki-link off the cursor line, with the note name', () => {
		const doc = 'x\na [[Note One]] b [[Other|the label]] c ![[img.png]]\n[[Here]]';
		const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: EditorSelection.cursor(doc.length) });
		expect(wikiLinks(state, 0, doc.length).map((l) => [doc.slice(l.from, l.to), l.name])).toEqual([
			['Note One', 'Note One'],
			['the label', 'Other']
		]);
	});
});

describe('links and images', () => {
	const doc = 'x\nsee [docs](https://x.y "t"), <https://z.z>, https://a.b/c and ![shot](attachments/a%20b.png) ![[Pasted image.png|alt]]\ncursor [here](u)';
	const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: EditorSelection.cursor(doc.length) });
	ensureSyntaxTree(state, doc.length, 5000);
	it('links: the visible text and its target, not on the cursor line', () => {
		expect(links(state, 0, doc.length).map((l) => [doc.slice(l.from, l.to), l.href])).toEqual([
			['docs', 'https://x.y'],
			['https://z.z', 'https://z.z'],
			['https://a.b/c', 'https://a.b/c']
		]);
	});
	it('images: the whole embed, with src as written and the alt', () => {
		expect(images(state, 0, doc.length).map((i) => [doc.slice(i.from, i.to), i.src, i.alt])).toEqual([
			['![shot](attachments/a%20b.png)', 'attachments/a%20b.png', 'shot'],
			['![[Pasted image.png|alt]]', 'Pasted%20image.png', 'alt']
		]);
	});
	it('hides the autolink brackets', () => {
		expect(visible('x\n<https://z.z>')).toBe('x\nhttps://z.z');
	});
});

describe('tables', () => {
	it('rows of cells with alignment, inline runs kept, empty cells filled in', () => {
		const doc = 'x\n| Name | **Qty** |\n|:-----|-------:|\n| a `b` | [l](u) |\n| c | |\n\nafter';
		const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: EditorSelection.cursor(doc.length) });
		ensureSyntaxTree(state, doc.length, 5000);
		const [t, ...rest] = tables(state, 0, doc.length);
		expect(rest).toEqual([]);
		expect(doc.slice(t.from, t.to)).toBe('| Name | **Qty** |\n|:-----|-------:|\n| a `b` | [l](u) |\n| c | |');
		expect(t.align).toEqual(['left', 'right']);
		expect(t.rows).toEqual([
			[['Name'], [{ tag: 'strong', kids: ['Qty'] }]],
			[['a ', { tag: 'code', kids: ['b'] }], [{ tag: 'a', href: 'u', kids: ['l'] }]],
			[['c'], []]
		]);
	});
	it('a table the cursor is in stays text', () => {
		const doc = '| a |\n|---|\n| b |';
		const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })], selection: EditorSelection.cursor(8) });
		ensureSyntaxTree(state, doc.length, 5000);
		expect(tables(state, 0, doc.length)).toEqual([]);
	});
});
