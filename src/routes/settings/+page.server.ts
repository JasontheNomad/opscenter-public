import { listStageMap } from '$lib/server/tasks';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ stages: listStageMap() });
