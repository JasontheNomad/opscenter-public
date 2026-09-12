import { error } from '@sveltejs/kit';
import { teamsConnected, listTeams, channelMessagesCached, me } from '$lib/server/teams';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/api';

export const load: PageServerLoad = async ({ params }) => {
	if (!teamsConnected()) error(401, 'Teams not connected');
	const teams = await listTeams();
	const team = teams.find((t) => t.id === params.team);
	const channel = team?.channels.find((c) => c.id === params.channel);
	if (!team || !channel) error(404, 'channel not found');
	try {
		const my = await me();
		return { team, channel, messages: await channelMessagesCached(team.id, channel.id, my.id), error: null };
	} catch (e) {
		return { team, channel, messages: [], error: errMsg(e) };
	}
};
