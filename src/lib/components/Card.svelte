<script lang="ts">
	import { ymd } from '$lib/dates';
	import { PRIORITY } from '$lib/priority';
	import { parseChecklist, isUnseen, needsReply, type Task } from '$lib/types';

	let {
		task,
		selected = false,
		onselect
	}: { task: Task; selected?: boolean; onselect: (id: number) => void } = $props();

	// short pipeline name for the badge: "Customer Onboarding" -> "Onboarding", "Support Pipeline" -> "Support"
	const badge = (label: string | null | undefined) =>
		(label ?? 'HS').replace(/pipeline/i, '').trim().split(' ').pop();
	const overdue = $derived(!!task.due_date && task.due_date < ymd());
	const list = $derived(parseChecklist(task.checklist));
	const reply = $derived(needsReply(task));
</script>

<!-- Enter stops here: the board's own Enter hotkey would otherwise re-select the first card -->
<div
	class="cursor-pointer rounded-md border bg-surface-2 px-3 py-2 shadow-sm transition-colors {selected
		? 'border-accent'
		: 'border-border hover:border-border-2'}"
	onclick={() => onselect(task.id)}
	data-task={task.id}
	role="button"
	tabindex="0"
	onkeydown={(e) => { if (e.key === 'Enter') (e.stopPropagation(), onselect(task.id)); }}
>
	<div class="flex items-start gap-2">
		<span class="mt-1.5 size-1.5 shrink-0 rounded-full {isUnseen(task) ? 'bg-alert ring-2 ring-alert/30' : task.priority ? PRIORITY[task.priority].dot : 'bg-transparent'}"></span>
		<p class="min-w-0 flex-1 leading-5 text-text {isUnseen(task) ? 'font-semibold' : ''}">{task.title}</p>
	</div>
	{#if task.source !== 'manual' || task.due_date || task.company_name || list.length}
		<div class="mt-1.5 flex items-center gap-2 pl-3.5 text-caption text-muted">
			{#if list.length}<span class={list.every((i) => i.done) ? 'text-p-low' : ''}>☑ {list.filter((i) => i.done).length}/{list.length}</span>{/if}
			{#if isUnseen(task)}<span class="rounded bg-alert/20 px-1 py-px font-medium text-alert-soft">{task.hs_change === 'new' ? 'new' : task.hs_change === 'stage' ? 'stage changed' : 'client replied'}</span>{/if}
			{#if reply}<span class="rounded bg-accent/20 px-1 py-px font-medium text-accent">needs reply</span>{/if}
			{#if task.source !== 'manual'}
				<span class="rounded border border-border px-1 py-px font-mono">{badge(task.hs_pipeline_label)}</span>
				{#if task.hs_stage_label}<span class="truncate">{task.hs_stage_label}</span>{/if}
			{/if}
			{#if task.company_name}<span class="truncate">{task.company_name}</span>{/if}
			{#if task.due_date}
				{#if overdue}<span class="size-1.5 shrink-0 rounded-full bg-p-urgent" title="Overdue — due {task.due_date}"></span>
				{:else}<span>{task.due_date}</span>{/if}
			{/if}
		</div>
	{/if}
</div>
