// The call's own window, Teams-style: pre-join and the live call open in a real popup instead of a
// box in the corner of the board.
//
// The popup is an empty same-origin window that this page mounts Svelte into, so the engine, the SDK
// and every video element stay in this page's JS — the popup is only a second screen. Two
// consequences: closing OpsCenter's main window ends the call, and the popup must be opened from a
// click (browsers block it otherwise; the engine calls open() before its first await for that
// reason). Picture-in-Picture was tried first and rejected: Chromium caps it at half the screen.
import { mount, unmount } from 'svelte';
import { calls } from './engine.svelte';
import CallWindow from '$lib/components/CallWindow.svelte';

const NAME = 'opscenter-call';
const SHARE = 0.8; // of the screen, about what the Teams meeting window takes

class CallWin {
	win = $state<Window | null>(null);
	#app: ReturnType<typeof mount> | null = null;

	/** False when the browser refused the popup — the layout then shows the call in-app instead. */
	open(title: string): boolean {
		if (this.win && !this.win.closed) {
			this.win.document.title = title;
			this.win.focus();
			return true;
		}
		const w = Math.round(screen.availWidth * SHARE);
		const h = Math.round(screen.availHeight * SHARE);
		const left = Math.round((screen.availWidth - w) / 2);
		const top = Math.round((screen.availHeight - h) / 2);
		const win = window.open('', NAME, `popup,width=${w},height=${h},left=${left},top=${top}`);
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
		// about:blank gets no Brave zoom, so give the call window the app's old scale directly
		doc.documentElement.style.setProperty('--ui-zoom', '1.15');
		this.#app = mount(CallWindow, { target: doc.body, props: { onclose: () => this.close() } });

		// closing the window mid-call leaves the call, as Teams does — after the browser asks
		win.addEventListener('beforeunload', (e) => { if (calls.inCall) e.preventDefault(); });
		win.addEventListener('pagehide', () => this.#closed(win));
		this.win = win;
		return true;
	}

	focus() { this.win?.focus(); }
	/** Cleanup runs from the window's pagehide, whoever closed it. */
	close() { this.win?.close(); }

	#closed(win: Window) {
		if (this.win !== win) return;
		if (this.#app) { void unmount(this.#app); this.#app = null; }
		this.win = null;
		if (calls.inCall) void calls.hangUp();
		else if (calls.pending) void calls.cancelPending();
	}
}

export const callWindow = new CallWin();

// the popup has no life of its own: take it down with this page (reload, quit)
if (typeof window !== 'undefined') addEventListener('pagehide', () => callWindow.close());
