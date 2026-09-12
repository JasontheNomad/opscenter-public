// Drag behaviour for the local-video PiP (Phase 5).
//
// Kept as an action rather than inline handlers so the clamping — which is the only fiddly part —
// lives in one place. Offsets are stored relative to the element's CSS anchor (bottom-right), so the
// PiP stays put when the call window is resized between compact and docked.
export function pipDrag(node: HTMLElement) {
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let originX = 0;
	let originY = 0;

	const apply = () => (node.style.transform = `translate(${x}px, ${y}px)`);

	/** Keep the whole tile inside its container, whatever just changed size. */
	const clamp = () => {
		const parent = node.offsetParent as HTMLElement | null;
		if (!parent) return;
		const p = parent.getBoundingClientRect();
		const n = node.getBoundingClientRect();
		// how far it can travel from its anchored corner before a rounded edge pokes out
		const left = n.left - x;
		const top = n.top - y;
		const minX = p.left + 8 - left;
		const maxX = p.right - 8 - (left + n.width);
		const minY = p.top + 8 - top;
		const maxY = p.bottom - 8 - (top + n.height);
		x = Math.min(Math.max(x, minX), maxX);
		y = Math.min(Math.max(y, minY), maxY);
		apply();
	};

	const move = (e: PointerEvent) => {
		x = originX + (e.clientX - startX);
		y = originY + (e.clientY - startY);
		clamp();
	};

	const up = (e: PointerEvent) => {
		node.releasePointerCapture?.(e.pointerId);
		node.removeEventListener('pointermove', move);
		node.removeEventListener('pointerup', up);
		node.removeEventListener('pointercancel', up);
		node.style.cursor = 'grab';
	};

	const down = (e: PointerEvent) => {
		if (e.button !== 0) return;
		e.preventDefault(); // otherwise the browser starts a text/image drag on the video
		startX = e.clientX;
		startY = e.clientY;
		originX = x;
		originY = y;
		node.setPointerCapture?.(e.pointerId);
		node.style.cursor = 'grabbing';
		node.addEventListener('pointermove', move);
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', up);
	};

	// a layout switch resizes the container under a PiP that may now be outside it
	const ro = new ResizeObserver(() => clamp());
	const parent = node.offsetParent;
	if (parent instanceof HTMLElement) ro.observe(parent);

	node.style.cursor = 'grab';
	node.style.touchAction = 'none';
	node.addEventListener('pointerdown', down);

	return {
		destroy() {
			ro.disconnect();
			node.removeEventListener('pointerdown', down);
		}
	};
}
