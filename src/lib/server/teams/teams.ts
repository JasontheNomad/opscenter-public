// Teams + channels listing (cached) and manual ordering.
import { DEMO, demoTeams } from '../demo';
import { MIN } from './shared';
import { graph } from './graph';
import { channelOrder, teamOrder } from './prefs';

// ---- teams + channels (listing only needs *.ReadBasic.All; reading messages needs admin-consented ChannelMessage.Read.All)
export type Channel = { id: string; name: string; webUrl: string; membershipType: string };
export type Team = { id: string; name: string; channels: Channel[] };
let teamsCache: { at: number; data: Team[] } | null = null;
export async function listTeams(): Promise<Team[]> {
	if (DEMO()) return demoTeams;
	if (teamsCache && Date.now() - teamsCache.at < 10 * MIN) return teamsCache.data;
	const t = await graph<{ value: { id: string; displayName: string }[] }>('/me/joinedTeams');
	const data = await Promise.all(
		t.value.map(async (tm) => {
			const c = await graph<{ value: { id: string; displayName: string; webUrl: string; membershipType?: string }[] }>(`/teams/${tm.id}/channels`).catch(() => ({ value: [] }));
			return {
				id: tm.id, name: tm.displayName,
				channels: c.value.map((ch) => ({ id: ch.id, name: ch.displayName, webUrl: ch.webUrl, membershipType: ch.membershipType ?? 'standard' }))
			};
		})
	);
	data.sort((a, b) => a.name.localeCompare(b.name));
	teamsCache = { at: Date.now(), data };
	return data;
}

const sortBy = <T extends { id: string }>(list: T[], order: string[]) => {
	const pos = new Map(order.map((id, i) => [id, i]));
	return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
};
export const applyTeamOrder = (teams: Team[]): Team[] => {
	const co = channelOrder();
	return sortBy(teams, teamOrder()).map((t) => ({ ...t, channels: sortBy(t.channels, co[t.id] ?? []) }));
};

