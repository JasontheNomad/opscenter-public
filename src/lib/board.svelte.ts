// Board state + mutations for the kanban page: columns, selection, optimistic patches, drag/drop push.
import { invalidateAll } from '$app/navigation';
import { untrack } from 'svelte';
import { nowIso } from '$lib/dates';
import { COLUMNS, type Status } from '$lib/columns';
import type { Task } from '$lib/types';
import type { TaskPatch } from '$lib/server/tasks';
import { api, post, errMsg } from '$lib/api';

export type Cols = Record<Status, Task[]>;
export const group = (tasks: Task[]): Cols => {
	const b = {} as Cols;
	for (const c of COLUMNS) b[c.id] = [];
	for (const t of tasks) b[t.status]?.push(t);
	return b;
};

export class Board {
	cols = $state<Cols>(group([]));
	selectedId = $state<number | null>(null);
	all = $derived(Object.values(this.cols).flat());
	selected = $derived(this.selectedId === null ? null : (this.all.find((t) => t.id === this.selectedId) ?? null));

	// A refresh (the 90 s timer, another write's re-read) may carry data from before a write still in flight.
	// Cards with one keep their local copy, and a refresh mid-drag waits for the next one.
	#pending = new Set<number>();
	#dragging = false;

	constructor(tasks: Task[]) {
		this.cols = group(tasks);
	}
	// Called from an $effect, so the read of the current cards must be untracked: read-then-write of `cols`
	// made the effect re-trigger itself until Svelte aborted (effect_update_depth_exceeded), and every
	// Projects/Support switch fell back to a full page reload.
	reset(tasks: Task[]) {
		if (this.#dragging) return;
		const local = untrack(() => new Map(this.all.filter((t) => this.#pending.has(t.id)).map((t) => [t.id, t])));
		this.cols = group(tasks.map((t) => local.get(t.id) ?? t));
	}
	/** svelte-dnd-action's `consider`: the card is in the air. */
	consider(status: Status, items: Task[]) {
		this.#dragging = true;
		this.cols[status] = items;
	}
	find(id: number) {
		return this.all.find((t) => t.id === id);
	}
	toggle(id: number) {
		this.selectedId = this.selectedId === id ? null : id;
	}
	patchLocal(id: number, patch: Partial<Task>) {
		for (const c of COLUMNS) this.cols[c.id] = this.cols[c.id].map((t) => (t.id === id ? { ...t, ...patch } : t));
	}
	// Optimistic writes. On failure, re-read the server's truth (undoes the local change) and return the
	// error for the header notice — a HubSpot push that 502s would otherwise look saved until the next sync.
	async #undo(e: unknown): Promise<string> {
		await invalidateAll();
		return errMsg(e);
	}
	async patch(id: number, patch: TaskPatch): Promise<string> {
		this.patchLocal(id, { ...patch, updated_at: nowIso() });
		this.#pending.add(id);
		try {
			await api(`/api/tasks/${id}`, 'PATCH', patch);
			this.#pending.delete(id);
			return '';
		} catch (e) {
			this.#pending.delete(id); // before #undo: its re-read must replace this card
			return `Not saved: ${await this.#undo(e)}`;
		}
	}
	async create(title: string) {
		const task = await post<Task>('/api/tasks', { title });
		this.cols[task.status] = [...this.cols[task.status], task];
		await invalidateAll();
	}
	// Column drop: shown moved at once; the server pushes the stage to HubSpot before it keeps the move, and a
	// refusal comes back as an error that re-reads the board (undoing it). `moved` is the dragged card — by
	// default the one arriving from another column, i.e. still carrying its old status. Returns a notice for
	// the header, '' if none.
	async finalize(status: Status, items: Task[], moved = items.find((t) => t.status !== status)?.id): Promise<string> {
		this.#dragging = false;
		this.cols[status] = items.map((t) => ({ ...t, status }));
		if (moved !== undefined) this.#pending.add(moved);
		let res: { pushed?: { stage: string }[]; skipped?: { reason: string }[] };
		try {
			res = await post('/api/tasks/reorder', { status, ids: items.map((t) => t.id), moved });
		} catch (e) {
			if (moved !== undefined) this.#pending.delete(moved);
			return `Not moved: ${await this.#undo(e)}`;
		}
		if (moved !== undefined) this.#pending.delete(moved);
		const { pushed, skipped } = res;
		if (pushed?.length) await invalidateAll();
		if (skipped?.length) return `Not pushed to HubSpot: ${skipped.map((s) => s.reason).join('; ')}`;
		if (pushed?.length) return `HubSpot → ${pushed.map((p) => p.stage).join(', ')}`;
		return '';
	}
	async move(t: Task, status: Status): Promise<string> {
		if (t.status === status) return '';
		this.cols[t.status] = this.cols[t.status].filter((x) => x.id !== t.id);
		return this.finalize(status, [...this.cols[status], { ...t, status }], t.id);
	}
	async remove(id: number): Promise<string> {
		if (this.selectedId === id) this.selectedId = null;
		for (const c of COLUMNS) this.cols[c.id] = this.cols[c.id].filter((t) => t.id !== id);
		try {
			await api(`/api/tasks/${id}`, 'DELETE');
			return '';
		} catch (e) {
			return `Not deleted: ${await this.#undo(e)}`;
		}
	}
}
