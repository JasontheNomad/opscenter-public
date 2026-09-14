// Every column id any board can use. Each view shows its own subset (see views.ts).
export const COLUMNS = [
	{ id: 'todo', name: 'Todo' },
	{ id: 'new_customer', name: 'New Customer' },
	{ id: 'kickoff_scheduled', name: 'Kickoff Scheduled' },
	{ id: 'kickoff_done', name: 'Kickoff Meeting Complete' },
	{ id: 'in_progress', name: 'In Progress' },
	{ id: 'testing', name: 'External Testing' },
	{ id: 'hypercare', name: 'HyperCare' },
	{ id: 'waiting', name: 'Waiting on Client' },
	{ id: 'waiting_me', name: 'Waiting on You' },
	{ id: 'done', name: 'Done' }
] as const;

export type Status = (typeof COLUMNS)[number]['id'];
export type Column = (typeof COLUMNS)[number];
const STATUS_IDS = COLUMNS.map((c) => c.id) as Status[];
export const isStatus = (s: unknown): s is Status => STATUS_IDS.includes(s as Status);

const pick = (ids: Status[]): Column[] => ids.map((id) => COLUMNS.find((c) => c.id === id)!);
export const BOARD_COLUMNS = pick(['todo', 'in_progress', 'waiting', 'waiting_me', 'done']);
export const PROJECT_COLUMNS = pick(['new_customer', 'kickoff_scheduled', 'kickoff_done', 'in_progress', 'testing', 'hypercare', 'done']);
