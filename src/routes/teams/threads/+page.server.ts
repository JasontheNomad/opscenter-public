import { activityList, markActivitySeen } from '$lib/server/teams';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = () => {
	const items = activityList('thread');
	markActivitySeen('thread');
	return { kind: 'thread' as const, title: 'Followed threads', items };
};
