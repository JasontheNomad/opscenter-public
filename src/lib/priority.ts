// Task priority scale (0 none … 4 urgent). Index = Task.priority.
export const PRIORITY = [
	{ label: 'None', dot: 'bg-border-2' },
	{ label: 'Low', dot: 'bg-p-low' },
	{ label: 'Medium', dot: 'bg-p-med' },
	{ label: 'High', dot: 'bg-p-high' },
	{ label: 'Urgent', dot: 'bg-p-urgent' }
] as const;
/** A valid index into PRIORITY — anything else (a stray 7) made the card's `PRIORITY[p].dot` throw. */
export const isPriority = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < PRIORITY.length;
// HubSpot hs_ticket_priority <-> index above
export const HS_PRIORITY = [null, 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const priorityFromHs = (v: string | null | undefined) => Math.max(0, HS_PRIORITY.indexOf((v ?? null) as (typeof HS_PRIORITY)[number]));
