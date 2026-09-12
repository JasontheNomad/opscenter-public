<script lang="ts">
	import type { Activity } from '$lib/types';
	import { escapeHtml, linkUrls } from '$lib/html';
	import { shortDateTime as when } from '$lib/format';
	import { kb } from '$lib/attachments';

	let { items, empty }: { items: Activity[]; empty: string } = $props();


	// escape, then linkify http(s) URLs + emails (link styling on the <p> below)
	const linkify = (s: string) =>
		linkUrls(escapeHtml(s)).replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+)/g, '$1<a href="mailto:$2">$2</a>');

	// hide the portal's auto "Attached: x.png" line when we render the file itself
	const bodyOf = (a: Activity) =>
		a.attachments.length ? a.body.replace(/^Attached:.*$/gm, '').trim() : a.body;
</script>

<div class="flex flex-col gap-3">
	{#each items as a (a.kind + a.id)}
		<article class="rounded-md border border-border bg-surface-2 px-3 py-2 {a.portal ? 'border-l-2 border-l-accent' : ''}">
			<header class="mb-1 flex items-center gap-2 text-caption text-muted">
				<span class="font-medium text-text">{a.author}</span>
				<span>{when(a.at)}</span>
				<span class="rounded border border-border px-1 font-mono">{a.kind}</span>
				{#if a.subject}<span class="truncate">· {a.subject}</span>{/if}
			</header>
			{#if bodyOf(a)}
				<p class="text-xs leading-5 whitespace-pre-wrap [&_a]:break-all [&_a]:text-accent [&_a]:underline">{@html linkify(bodyOf(a))}</p>
			{/if}
			{#if a.attachments.length}
				<div class="mt-2 flex flex-wrap gap-2">
					{#each a.attachments as f (f.id)}
						{#if f.image}
							<img src="/api/files/{f.id}" alt={f.name} title={f.name} class="max-h-48 max-w-full cursor-zoom-in rounded-md border border-border object-contain hover:border-accent" loading="lazy" data-zoom />
						{:else}
							<a href="/api/files/{f.id}" target="_blank" rel="noreferrer" class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-caption text-text hover:border-accent">
								📎 <span class="truncate">{f.name}</span>{#if f.size}<span class="text-muted">{kb(f.size)}</span>{/if}
							</a>
						{/if}
					{/each}
				</div>
			{/if}
		</article>
	{:else}
		<p class="text-xs text-muted">{empty}</p>
	{/each}
</div>
