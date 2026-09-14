<script lang="ts">
	// Team note / client reply box: drop zone, attachment strip, Enter posts, 📎 picker.
	// Draft and attachments are the parent's (bound), so switching tabs away and back keeps them.
	import type { Snippet } from 'svelte';
	import { readFiles, pastedFiles, tooBig, type Att } from '$lib/attachments';
	import { dropzone, enterSubmits, pickFiles } from '$lib/composer';
	import AttachmentStrip from './AttachmentStrip.svelte';

	let {
		draft = $bindable(),
		atts = $bindable(),
		error = $bindable(),
		placeholder,
		label,
		tall = false,
		blocked = false,
		busy,
		onsend,
		header
	}: {
		draft: string;
		atts: Att[];
		error: string;
		placeholder: string;
		label: string;
		tall?: boolean;
		blocked?: boolean;
		busy: boolean;
		onsend: () => void;
		header?: Snippet;
	} = $props();

	let box: HTMLTextAreaElement | undefined = $state();
	export const focus = () => box?.focus();

	async function addFiles(list: FileList | File[] | null | undefined) {
		const { atts: read, rejected } = await readFiles(list);
		if (rejected.length) error = tooBig(rejected);
		if (read.length) atts = [...atts, ...read];
	}
	function onPaste(e: ClipboardEvent) {
		const files = pastedFiles(e);
		if (!files.length) return;
		e.preventDefault();
		void addFiles(files);
	}
</script>

<form class="mb-3 flex flex-col gap-2" onsubmit={(e) => (e.preventDefault(), onsend())} {@attach dropzone((f) => void addFiles(f))}>
	<AttachmentStrip {atts} onremove={(i) => (atts = atts.filter((_, j) => j !== i))} />
	{@render header?.()}
	<textarea
		bind:this={box}
		bind:value={draft}
		class="{tall ? 'min-h-24' : 'min-h-20'} resize-y rounded-md border border-border bg-surface-2 p-2 text-xs leading-5 focus-accent"
		{placeholder}
		onkeydown={enterSubmits(onsend)}
		onpaste={onPaste}
	></textarea>
	<div class="flex items-center gap-2">
		<button class="btn-primary px-3 py-1 text-xs" disabled={busy || blocked || (!draft.trim() && !atts.length)}>{busy ? 'Sending…' : label}</button>
		<label class="cursor-pointer rounded-md border border-border px-2 py-1 text-xs link-muted" title="Attach"><input type="file" multiple class="hidden" onchange={pickFiles((f) => void addFiles(f))} />📎</label>
		{#if error}<span class="err">{error}</span>{/if}
	</div>
</form>
