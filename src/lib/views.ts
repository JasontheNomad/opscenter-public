import { BOARD_COLUMNS, PROJECT_COLUMNS, type Column } from './columns';

// Sidebar views. Filter runs server-side in listTasks().
export const PROJECT_PIPELINE_LABEL = 'Customer Onboarding';
export const SUPPORT_PIPELINE_LABEL = 'Support Pipeline';

export const VIEWS = [
	{ id: 'projects', path: '/projects', name: 'Projects', blurb: 'Customer Onboarding', manual: false, hideDone: true, columns: PROJECT_COLUMNS },
	{ id: 'support', path: '/support', name: 'Support', blurb: 'Help desk tickets', manual: false, hideDone: true, columns: BOARD_COLUMNS },
	{ id: 'tasks', path: '/tasks', name: 'Tasks', blurb: 'Manual, local only', manual: true, hideDone: false, columns: BOARD_COLUMNS }
] as const;

export type ViewId = (typeof VIEWS)[number]['id'];
export const isView = (s: unknown): s is ViewId => VIEWS.some((v) => v.id === s);

// columns a HubSpot pipeline's records can sit in
export const columnsForPipeline = (label: string | null): readonly Column[] =>
	label === PROJECT_PIPELINE_LABEL ? PROJECT_COLUMNS : BOARD_COLUMNS;
