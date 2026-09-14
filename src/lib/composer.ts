// Composer helpers shared by Panel / TeamsThread: drop zone highlighting, Enter-to-submit, file picker reset.
const HL = ['border-accent', 'bg-accent/5'];

// {@attach dropzone(files => …)}: highlights the element while a file is dragged over it, hands dropped files back
export const dropzone = (onfiles: (files: File[]) => void) => (el: HTMLElement) => {
	const over = (e: DragEvent) => { e.preventDefault(); el.classList.add(...HL); };
	const leave = () => el.classList.remove(...HL);
	const drop = (e: DragEvent) => { e.preventDefault(); leave(); const f = Array.from(e.dataTransfer?.files ?? []); if (f.length) onfiles(f); };
	el.addEventListener('dragover', over); el.addEventListener('dragleave', leave); el.addEventListener('drop', drop);
	return () => { el.removeEventListener('dragover', over); el.removeEventListener('dragleave', leave); el.removeEventListener('drop', drop); };
};
// onkeydown={enterSubmits(send)}: Enter posts, Shift+Enter = newline
export const enterSubmits = (fn: () => void) => (e: KeyboardEvent) => {
	if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fn(); }
};
// onchange for <input type=file>: hand files over and reset so the same file can be picked again
export const pickFiles = (onfiles: (files: FileList | null) => void) => (e: Event & { currentTarget: HTMLInputElement }) => {
	onfiles(e.currentTarget.files);
	e.currentTarget.value = '';
};
