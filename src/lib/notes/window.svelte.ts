// A note in its own window, the way a call gets one (lib/calls/window.svelte.ts).
//
// Same shape as the call window and the same two consequences: the popup is an empty same-origin
// window this page mounts Svelte into, so the editor and its autosave live in this page's JS, and
// closing OpsCenter closes every note window with it. It must be opened straight from the click that
// asked for it — browsers block a popup opened after an await, so the fetch for the note's text
// happens inside the window, not before it.
//
// One window per note, keyed by client/file: opening the same note twice focuses the window that
// already has it rather than making a second editor over the same file.
import { mount, unmount } from 'svelte';
import NoteWindow from '$lib/components/NoteWindow.svelte';

const SHARE = 0.55; // a note is a column of text, not a meeting — narrower than the call window
type Open = { win: Window; app: ReturnType<typeof mount> };

class NoteWindows {
	#open = new Map<string, Open>();

	/** False when the browser refused the popup; the caller then falls back to opening in the page. */
	open(client: string, file: string, title = file.replace(/\.md$/, '')): boolean {
		const key = `${client}/${file}`;
		const had = this.#open.get(key);
		if (had && !had.win.closed) {
			had.win.document.title = title;
			had.win.focus();
			return true;
		}

		const w = Math.round(screen.availWidth * SHARE);
		const h = Math.round(screen.availHeight * 0.8);
		// cascade: a second note shouldn't land exactly on the first
		const step = this.#open.size * 28;
		const left = Math.round((screen.availWidth - w) / 2) + step;
		const top = Math.round((screen.availHeight - h) / 2) + step;
		// the window name must be unique per note, or the browser reuses one popup for all of them
		const win = window.open('', `opscenter-note-${key.replace(/\W+/g, '-')}`, `popup,width=${w},height=${h},left=${left},top=${top}`);
		if (!win) return false;

		const doc = win.document;
		// a window left over from before a reload keeps its old contents; start clean
		doc.head.replaceChildren();
		doc.body.replaceChildren();
		doc.title = title;
		// about:blank has no styles: copy this page's (same-origin, so every rule is readable)
		const css = doc.createElement('style');
		css.textContent = [...document.styleSheets]
			.map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } })
			.join('\n');
		doc.head.append(css);
		doc.body.style.margin = '0';

		const app = mount(NoteWindow, { target: doc.body, props: { client, file, onclose: () => win.close() } });
		win.addEventListener('pagehide', () => this.#closed(key, win));
		this.#open.set(key, { win, app });
		return true;
	}

	#closed(key: string, win: Window) {
		const cur = this.#open.get(key);
		if (!cur || cur.win !== win) return;
		void unmount(cur.app);
		this.#open.delete(key);
	}

	closeAll() {
		for (const { win } of this.#open.values()) win.close();
	}
}

export const noteWindows = new NoteWindows();

// the popups have no life of their own: take them down with this page (reload, quit)
if (typeof window !== 'undefined') addEventListener('pagehide', () => noteWindows.closeAll());
