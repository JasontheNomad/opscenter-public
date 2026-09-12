<script lang="ts">
	import { api } from '$lib/api';
	import { columnsForPipeline } from '$lib/views';
	import { invalidateAll } from '$app/navigation';
	import { TEXT_AREAS, TEXT_SIZES, DEFAULT_SIZE, type TextArea } from '$lib/textSize';
	import { textPanel } from '$lib/textPanel.svelte';

	let { data } = $props();

	const pipelines = $derived(
		[...new Set(data.stages.map((s) => s.pipeline_label))].map((label) => ({
			label,
			columns: columnsForPipeline(label),
			stages: data.stages.filter((s) => s.pipeline_label === label)
		}))
	);

	async function setSize(area: TextArea, size: number) {
		await api('/api/settings/text-size', 'PATCH', { area, size });
		await invalidateAll(); // every area reads it from the root layout
	}

	let saved = $state<string | null>(null);
	async function save(source: string, hs_stage: string, status: string) {
		await api('/api/stage-map', 'PATCH', { source, hs_stage, status });
		saved = hs_stage;
		setTimeout(() => (saved = null), 1200);
	}
</script>

<div class="w-full overflow-y-auto">
<div class="mx-auto max-w-2xl p-6">
	<header class="mb-6">
		<h1 class="text-sm font-semibold">Settings</h1>
		<div class="text-caption text-muted">Text size · Stage mapping</div>
	</header>

	<section class="mb-8">
		<div class="mb-2 flex items-center">
			<h2 class="flex-1 text-xs font-medium text-muted uppercase">Text size</h2>
			<button class="btn px-2.5 py-1 text-xs" onclick={() => (textPanel.open = true)} title="A floating panel that stays open while you move around the app">Pop out</button>
		</div>
		<p class="mb-3 text-xs text-muted">Font size of the main text in each area; everything else there scales with it. Brave's zoom (⌘ + / ⌘ −) still scales the whole app on top.</p>
		<div class="divide-y divide-border rounded-md border border-border bg-surface">
			{#each TEXT_AREAS as a (a.id)}
				<div class="flex items-center gap-3 px-3 py-2">
					<span class="flex-1">{a.name} <span class="text-caption text-muted">· {a.hint}</span></span>
					<select
						class="rounded border border-border bg-surface-2 px-2 py-1 text-xs focus-accent"
						value={data.textSize[a.id] ?? DEFAULT_SIZE}
						onchange={(e) => setSize(a.id, Number(e.currentTarget.value))}
					>
						{#each TEXT_SIZES as px (px)}<option value={px}>{px}{px === DEFAULT_SIZE ? ' (default)' : ''}</option>{/each}
					</select>
				</div>
			{/each}
		</div>
	</section>

	<h2 class="mb-2 text-xs font-medium text-muted uppercase">Stage mapping</h2>
	<p class="mb-6 text-xs text-muted">
		HubSpot stage → board column. Pull uses this when a record changes in HubSpot. Push uses the
		first stage (top to bottom) in the record's pipeline mapped to the target column.
	</p>

	{#each pipelines as p (p.label)}
		<section class="mb-6">
			<h2 class="mb-2 text-xs font-medium text-muted uppercase">{p.label}</h2>
			<div class="divide-y divide-border rounded-md border border-border bg-surface">
				{#each p.stages as s (s.stage_id)}
					<div class="flex items-center gap-3 px-3 py-2">
						<span class="flex-1">{s.label}</span>
						{#if s.closed}<span class="text-2xs text-muted">closed</span>{/if}
						<select
							class="rounded border border-border bg-surface-2 px-2 py-1 text-xs focus-accent"
							value={s.status ?? p.columns[0].id}
							onchange={(e) => save(s.source, s.stage_id, e.currentTarget.value)}
						>
							{#each p.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
						</select>
						<span class="w-10 text-2xs text-accent">{saved === s.stage_id ? 'saved' : ''}</span>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>
</div>
