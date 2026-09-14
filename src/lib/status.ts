// Browser-safe bits of the status payload (server shape lives in $lib/server/status).
type Counts = { unread: number; mentions?: number; threads?: number; hubspot?: { unseen?: Record<string, number> } };
// one number for the Teams nav bubble + Dock badge
export const badgeCount = (s: Counts, withHubspot = false) =>
	s.unread + (s.mentions ?? 0) + (s.threads ?? 0) + (withHubspot ? (s.hubspot?.unseen?.support ?? 0) + (s.hubspot?.unseen?.projects ?? 0) : 0);
