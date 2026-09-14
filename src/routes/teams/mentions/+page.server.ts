import { activityList, markActivitySeen } from '$lib/server/teams';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = () => {
	const items = activityList('mention');
	markActivitySeen('mention');
	return { kind: 'mention' as const, title: 'Mentions', items };
};
