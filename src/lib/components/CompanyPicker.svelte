<script lang="ts">
	type Item = { id: string; name: string; sub?: string | null };

	let {
		companies,
		value,
		placeholder = 'Search companies…',
		onchange
	}: {
		companies: Item[];
		value: string | null;
		placeholder?: string;
		onchange: (id: string | null) => void;
	} = $props();

	const listId = $props.id(); // two pickers can mount at once (company + contact)
	const selected = $derived(companies.find((c) => c.id === value) ?? null);

	let q = $state('');
	let open = $state(false);
	let active = $state(0);
	let input: HTMLInputElement;

	const matches = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return companies.slice(0, 25);
		return companies
			.filter((c) => `${c.name} ${c.sub ?? ''}`.toLowerCase().includes(needle))
			.slice(0, 25);
	});

	function pick(c: Item | null) {
		onchange(c?.id ?? null);
		q = '';
		open = false;
		input.blur();
	}
	function keys(e: KeyboardEvent) {
		if (!open && e.key !== 'Escape') open = true;
		if (e.key === 'ArrowDown') (e.preventDefault(), (active = Math.min(active + 1, matches.length - 1)));
		else if (e.key === 'ArrowUp') (e.preventDefault(), (active = Math.max(active - 1, 0)));
		else if (e.key === 'Enter') (e.preventDefault(), matches[active] && pick(matches[active]));
		else if (e.key === 'Escape') (e.stopPropagation(), (open = false), input.blur());
	}
</script>

<div class="relative w-full max-w-sm">
	<div class="flex items-center gap-1">
		<input
			bind:this={input}
			bind:value={q}
			placeholder={selected?.name ?? placeholder}
			class="w-full rounded-md border border-border bg-surface-2 px-2 py-1 text-xs placeholder:text-text focus-accent {selected
				? ''
				: 'placeholder:text-muted'}"
			onfocus={() => (open = true)}
			onblur={() => (open = false)}
			oninput={() => (active = 0)}
			onkeydown={keys}
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
		/>
		{#if selected}
			<button type="button" class="px-1 link-muted" onclick={() => pick(null)} title="Clear">×</button>
		{/if}
	</div>
	{#if open}
		<ul
			id={listId}
			role="listbox"
			class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface-2 py-1 shadow-lg"
		>
			{#each matches as c, i (c.id)}
				<li
					role="option"
					aria-selected={i === active}
					class="cursor-pointer px-2 py-1 text-xs {i === active ? 'bg-surface text-text' : 'text-muted'}"
					onmousedown={(e) => (e.preventDefault(), pick(c))}
					onmouseenter={() => (active = i)}
				>
					<div class="truncate {i === active ? 'text-text' : 'text-text/90'}">{c.name}</div>
					{#if c.sub}<div class="truncate text-caption text-muted">{c.sub}</div>{/if}
				</li>
			{:else}
				<li class="px-2 py-1 text-xs text-muted">No match</li>
			{/each}
		</ul>
	{/if}
</div>
