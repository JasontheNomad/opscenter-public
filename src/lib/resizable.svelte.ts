// Drag-to-resize panes with the width remembered per browser (Sidebar right edge, Panel left edge).
export function persistedWidth(key: string, initial: number, min: number, max = Infinity) {
	let w = $state(initial);
	try {
		const saved = Number(localStorage.getItem(key));
		if (saved >= min && saved <= max) w = saved;
	} catch {}
	return {
		min, max,
		get value() { return w; },
		set value(v: number) { w = Math.min(max, Math.max(min, v)); },
		save() { try { localStorage.setItem(key, String(w)); } catch {} }
	};
}
// html { zoom } scales pointer coordinates
const uiZoom = () => Number(getComputedStyle(document.documentElement).zoom) || 1;

// {@attach resizable(width, 'left' | 'right')} on the drag handle. 'left' = pane hugs the right edge (Panel), 'right' = hugs the left (Sidebar)
export const resizable = (width: ReturnType<typeof persistedWidth>, side: 'left' | 'right', reserve = 300) => (el: HTMLElement) => {
	const down = (e: PointerEvent) => {
		e.preventDefault();
		const zoom = uiZoom();
		const max = side === 'left' ? Math.min(width.max, Math.max(width.min, window.innerWidth / zoom - reserve)) : width.max;
		const move = (ev: PointerEvent) => (width.value = Math.min(max, side === 'left' ? window.innerWidth / zoom - ev.clientX / zoom : ev.clientX / zoom));
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			width.save();
		};
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	};
	el.addEventListener('pointerdown', down);
	return () => el.removeEventListener('pointerdown', down);
};
