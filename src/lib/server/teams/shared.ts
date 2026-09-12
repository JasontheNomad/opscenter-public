// Shared constants + tiny helpers for the Teams modules.

// ---- timing / caps (ms unless noted)
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const BEAT_MS = 5_000; // poller base beat
export const CACHE_FRESH_MS = 25_000; // chat list / messages served from cache if younger than ~one poll
export const FOCUS_TTL_MS = 45_000; // PWA focus report is trusted this long
export const ACTIVITY_CAP = 200; // mentions/threads kept
export const isPost = (m: { messageType: string; deletedDateTime?: string | null }) => m.messageType === 'message' && !m.deletedDateTime;
export const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
