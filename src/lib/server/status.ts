// What the sidebar / PWA badge / notifications read: Teams status + HubSpot unseen counts.
import { teamsStatus, type TeamsStatus } from './teams';
import { viewUnseen, unseenTasks } from './tasks';
import { syncHealth } from './sync';
import { seedHealth } from './seed';

export type StatusPayload = TeamsStatus & { hubspot: { unseen: ReturnType<typeof viewUnseen>; items: ReturnType<typeof unseenTasks>; sync: typeof syncHealth; seed: typeof seedHealth } };
export const statusPayload = (): StatusPayload => ({ ...teamsStatus(), hubspot: { unseen: viewUnseen(), items: unseenTasks(), sync: { ...syncHealth }, seed: { ...seedHealth } } });
