// Whether the floating Text size panel is open — remembered per browser so it survives a reload.
const KEY = 'ocTextPanel';
let initial = false;
try { initial = typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }

class TextPanel {
	#open = $state(initial);
	get open() { return this.#open; }
	set open(v: boolean) {
		this.#open = v;
		try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ }
	}
}
export const textPanel = new TextPanel();
