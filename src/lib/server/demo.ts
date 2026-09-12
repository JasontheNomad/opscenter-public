// DEMO=1: fixture data instead of HubSpot/Graph, for screenshots and trying the UI without credentials.
import { nowIso } from '$lib/dates';
import { env } from '$env/dynamic/private';
import type { ChatSummary, ChatMessage, Team, CalEvent, Me } from './teams';

export const DEMO = () => env.DEMO === '1';

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const today = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const dayOffset = (days: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };

export const demoMe: Me = { id: 'me', displayName: 'Alex Rivera', mail: 'alex@example.com' };

const P = {
	sam: { id: 'u-sam', name: 'Sam Okafor' }, priya: { id: 'u-priya', name: 'Priya Natarajan' }, dana: { id: 'u-dana', name: 'Dana Whitfield' },
	leo: { id: 'u-leo', name: 'Leo Marchetti' }, mei: { id: 'u-mei', name: 'Mei Tanaka' }, jordan: { id: 'u-jordan', name: 'Jordan Blake' }
};

const chat = (id: string, topic: string | null, type: ChatSummary['chatType'], people: { id: string; name: string }[], last: { at: string; from: string; preview: string }, unread = false): ChatSummary => ({
	id, topic, chatType: type, webUrl: '#', lastMessageReadDateTime: unread ? iso(600) : last.at, last, unread,
	members: [demoMe.displayName, ...people.map((p) => p.name)], memberIds: ['me', ...people.map((p) => p.id)], people: [{ id: 'me', name: demoMe.displayName }, ...people]
});

export const demoChats: ChatSummary[] = [
	chat('c-sam', null, 'oneOnOne', [P.sam], { at: iso(3), from: 'Sam Okafor', preview: 'Pushed the fix — can you sanity check the intake flow?' }, true),
	chat('c-launch', 'Launch Squad', 'group', [P.priya, P.dana, P.leo], { at: iso(22), from: 'Priya Natarajan', preview: 'Demo deck v3 attached. Rehearsal at 2?' }, true),
	chat('c-priya', null, 'oneOnOne', [P.priya], { at: iso(95), from: 'Alex Rivera', preview: 'Sounds good, thanks!' }),
	chat('c-ops', 'Ops Sync', 'group', [P.mei, P.jordan], { at: iso(240), from: 'Mei Tanaka', preview: 'Renewal for Harbor Legal is signed 🎉' }),
	chat('c-dana', null, 'oneOnOne', [P.dana], { at: iso(1500), from: 'Dana Whitfield', preview: 'I\'ll send the contract over tonight.' }),
	chat('c-leo', null, 'oneOnOne', [P.leo], { at: iso(2900), from: 'Leo Marchetti', preview: 'Nice work on the onboarding copy.' }),
	chat('c-jordan', null, 'oneOnOne', [P.jordan], { at: iso(4300), from: 'Alex Rivera', preview: 'Let\'s revisit Friday.' })
];

const msg = (id: string, from: { id: string; name: string } | 'me', minsAgo: number, html: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
	id, at: iso(minsAgo), from: from === 'me' ? demoMe.displayName : from.name, fromId: from === 'me' ? 'me' : from.id, html, text: html.replace(/<[^>]+>/g, ''), me: from === 'me', files: [], reactions: [], ...extra
});

export const demoMessages: Record<string, ChatMessage[]> = {
	'c-sam': [
		msg('m1', P.sam, 190, 'Morning! The intake agent was transferring to the wrong queue after hours.'),
		msg('m2', 'me', 185, 'Saw it. Is it the routing rule or the calendar check?'),
		msg('m3', P.sam, 170, 'Routing rule — the after-hours branch never fired because the timezone was UTC.'),
		msg('m4', 'me', 160, 'Classic. Want me to add a regression test for that?', { reactions: [{ emoji: '👍', count: 1, mine: false }] }),
		msg('m5', P.sam, 40, '<blockquote class="quote"><span class="who">Alex Rivera</span>Want me to add a regression test for that?</blockquote>Yes please. Also added the callback number to the fallback prompt.'),
		msg('m6', P.sam, 3, 'Pushed the fix — can you sanity check the intake flow?')
	],
	'c-launch': [
		msg('l1', P.dana, 300, 'Reminder: launch checklist is in the shared drive.'),
		msg('l2', P.leo, 120, 'Pricing page copy is final. 🚀', { reactions: [{ emoji: '🎉', count: 3, mine: true }] }),
		msg('l3', 'me', 60, 'I\'ll run the full onboarding demo tomorrow morning and record it.'),
		msg('l4', P.priya, 22, 'Demo deck v3 attached. Rehearsal at 2?', { files: [{ name: 'Launch-Deck-v3.pdf', url: '#' }] })
	]
};
for (const c of demoChats) if (!demoMessages[c.id]) demoMessages[c.id] = [msg(`${c.id}-1`, c.people[1] ?? P.sam, 2000, 'Hey! Quick question about the rollout.'), msg(`${c.id}-2`, 'me', 1990, c.last?.preview ?? 'On it.')];

export const demoTeams: Team[] = [
	{ id: 't-cs', name: 'Customer Success', channels: [
		{ id: 'ch-general', name: 'General', webUrl: '#', membershipType: 'standard' },
		{ id: 'ch-harbor', name: 'Harbor Legal', webUrl: '#', membershipType: 'private' },
		{ id: 'ch-summit', name: 'Summit Injury Law', webUrl: '#', membershipType: 'private' },
		{ id: 'ch-alerts', name: 'Workflow Alerts', webUrl: '#', membershipType: 'private' }
	] },
	{ id: 't-eng', name: 'Engineering', channels: [
		{ id: 'ch-eng', name: 'General', webUrl: '#', membershipType: 'standard' },
		{ id: 'ch-deploys', name: 'Deploys', webUrl: '#', membershipType: 'standard' }
	] },
	{ id: 't-mkt', name: 'Marketing', channels: [{ id: 'ch-mkt', name: 'General', webUrl: '#', membershipType: 'standard' }] }
];

export const demoChannelMessages: Record<string, ChatMessage[]> = {
	'ch-alerts': [
		msg('a1', { id: 'bot', name: 'Workflows' }, 50, '<div class="card"><div class="card-title">Harbor Legal • Call Summary</div><div class="card-h">Phone</div><div class="card-p">(555) 014-2200</div><div class="card-h">Summary</div><div class="card-p">Caller asked to reschedule the intake appointment to Thursday; assistant confirmed and sent a calendar hold.</div><div class="card-actions"><a class="card-btn" href="#">Open Contact</a></div></div>'),
		msg('a2', { id: 'bot', name: 'Workflows' }, 12, '<div class="card"><div class="card-title">Summit Injury Law • Call Summary</div><div class="card-h">Phone</div><div class="card-p">(555) 019-8811</div><div class="card-h">Summary</div><div class="card-p">Prospect requested a callback about a workers\' comp claim; office closed, message queued for the morning team.</div><div class="card-actions"><a class="card-btn" href="#">Open Contact</a></div></div>')
	]
};
for (const t of demoTeams) for (const ch of t.channels) if (!demoChannelMessages[ch.id]) demoChannelMessages[ch.id] = [msg(`${ch.id}-1`, P.mei, 800, `Welcome to #${ch.name}. Standup notes go here.`), msg(`${ch.id}-2`, P.jordan, 700, 'Sounds good 👍', { reactions: [{ emoji: '👍', count: 2, mine: false }] })];

export const demoPresence: Record<string, string> = { 'u-sam': 'Available', 'u-priya': 'Busy', 'u-dana': 'Away', 'u-leo': 'Available', 'u-mei': 'DoNotDisturb', 'u-jordan': 'Offline' };

export const demoEvents: CalEvent[] = [
	{ id: 'e1', subject: 'Weekly Leadership Tactical', start: today(10), end: today(11), allDay: false, organizer: 'Dana Whitfield', organizerId: 'u-dana', attendees: 6, response: 'accepted', isOrganizer: false, joinUrl: '#', webLink: '#', location: '', preview: 'Pipeline review, launch blockers, hiring.', cancelled: false, recurring: true },
	{ id: 'e2', subject: 'Harbor Legal — Onboarding kickoff', start: today(13, 30), end: today(14, 30), allDay: false, organizer: 'Alex Rivera', organizerId: 'me', attendees: 4, response: 'organizer', isOrganizer: true, joinUrl: '#', webLink: '#', location: '', preview: 'Walk through intake + chase agents.', cancelled: false, recurring: false },
	{ id: 'e3', subject: 'Launch rehearsal', start: dayOffset(1, 14), end: dayOffset(1, 15), allDay: false, organizer: 'Priya Natarajan', organizerId: 'u-priya', attendees: 5, response: 'notResponded', isOrganizer: false, joinUrl: '#', webLink: '#', location: 'Room 4B', preview: '', cancelled: false, recurring: false },
	{ id: 'e4', subject: 'Summit Injury Law — QBR', start: dayOffset(2, 9), end: dayOffset(2, 10), allDay: false, organizer: 'Mei Tanaka', organizerId: 'u-mei', attendees: 3, response: 'tentativelyAccepted', isOrganizer: false, joinUrl: '#', webLink: '#', location: '', preview: '', cancelled: false, recurring: false },
	{ id: 'e5', subject: 'Focus block', start: dayOffset(3, 8), end: dayOffset(3, 10), allDay: false, organizer: 'Alex Rivera', organizerId: 'me', attendees: 1, response: 'organizer', isOrganizer: true, joinUrl: null, webLink: '#', location: '', preview: '', cancelled: false, recurring: true },
	{ id: 'e6', subject: 'Team offsite', start: dayOffset(4, 0), end: dayOffset(5, 0), allDay: true, organizer: 'Dana Whitfield', organizerId: 'u-dana', attendees: 12, response: 'accepted', isOrganizer: false, joinUrl: null, webLink: '#', location: 'Lakeside', preview: '', cancelled: false, recurring: false }
];

// ---- HubSpot-side fixtures: seed the SQLite tasks/companies/contacts/stages once
import type Database from 'better-sqlite3';
export function seedDemoDb(db: Database.Database) {
	if ((db.prepare('SELECT 1 FROM tasks LIMIT 1').get() as unknown) !== undefined) return;
	const now = nowIso();
	const co = db.prepare('INSERT OR REPLACE INTO companies (id, name, notes_dir) VALUES (?, ?, ?)');
	const companies = [['co1', 'Harbor Legal Group', 'Harbor Legal'], ['co2', 'Summit Injury Law', 'Summit Injury Law'], ['co3', 'Brightline Family Law', 'Brightline'], ['co4', 'Northwind Attorneys', null]];
	for (const c of companies) co.run(...c);
	const ct = db.prepare('INSERT OR REPLACE INTO contacts (id, name, email, company_id) VALUES (?, ?, ?, ?)');
	for (const c of [['p1', 'Maria Chen', 'maria@harborlegal.example', 'co1'], ['p2', 'Tom Alvarez', 'tom@harborlegal.example', 'co1'], ['p3', 'Grace Park', 'grace@summitinjury.example', 'co2'], ['p4', 'Owen Reyes', 'owen@brightline.example', 'co3'], ['p5', 'Nina Patel', 'nina@northwind.example', 'co4']]) ct.run(...c);
	const st = db.prepare('INSERT OR REPLACE INTO stages (source, pipeline_id, pipeline_label, stage_id, label, display_order, closed) VALUES (?, ?, ?, ?, ?, ?, ?)');
	const map = db.prepare('INSERT OR REPLACE INTO stage_map (source, hs_stage, status) VALUES (?, ?, ?)');
	const sup = [['s1', 'New', 'todo'], ['s2', 'Waiting on Customer', 'waiting'], ['s3', 'Waiting on Us', 'waiting_me'], ['s4', 'In Progress', 'in_progress'], ['s5', 'Closed', 'done']];
	const onb = [['o1', 'New Customer', 'new_customer'], ['o2', 'Kickoff Scheduled', 'kickoff_scheduled'], ['o3', 'Agent Build Started', 'in_progress'], ['o4', 'External Testing', 'testing'], ['o5', 'Revisions Needed', 'testing'], ['o6', 'Go Live', 'testing'], ['o7', 'Onboarding Complete', 'done']];
	sup.forEach((s, i) => { st.run('ticket', 'pipe-support', 'Support Pipeline', s[0], s[1], i, s[0] === 's5' ? 1 : 0); map.run('ticket', s[0], s[2]); });
	onb.forEach((s, i) => { st.run('ticket', 'pipe-onb', 'Customer Onboarding', s[0], s[1], i, s[0] === 'o7' ? 1 : 0); map.run('ticket', s[0], s[2]); });
	const t = db.prepare(`INSERT INTO tasks (title, notes, status, sort_order, priority, due_date, source, hs_id, hs_pipeline, hs_stage, hs_url, hs_modified_at, company_id, last_client_at, last_reply_at, hs_changed_at, hs_change, checklist)
		VALUES (@title, '', @status, @sort, @priority, @due, @source, @hs_id, @pipe, @stage, '#', @now, @co, @lc, @lr, @chg, @kind, @cl)`);
	const rows = [
		{ title: 'Transfer issue on after-hours calls', status: 'waiting_me', sort: 1, priority: 3, due: null, source: 'ticket', hs_id: 'h1', pipe: 'pipe-support', stage: 's3', co: 'co1', lc: iso(35), lr: iso(300), chg: iso(35), kind: 'reply', cl: '[]' },
		{ title: 'Add Spanish greeting to reception agent', status: 'in_progress', sort: 1, priority: 2, due: dayOffset(2, 0).slice(0, 10), source: 'ticket', hs_id: 'h2', pipe: 'pipe-support', stage: 's4', co: 'co2', lc: null, lr: null, chg: null, kind: null, cl: '[{"id":"a","text":"Draft greeting","done":true},{"id":"b","text":"Record voice sample","done":true},{"id":"c","text":"QA with client","done":false}]' },
		{ title: 'Callback number not announced', status: 'todo', sort: 1, priority: 1, due: null, source: 'ticket', hs_id: 'h3', pipe: 'pipe-support', stage: 's1', co: 'co3', lc: null, lr: null, chg: iso(120), kind: 'new', cl: '[]' },
		{ title: 'Voicemail transcription missing', status: 'waiting', sort: 1, priority: 2, due: null, source: 'ticket', hs_id: 'h4', pipe: 'pipe-support', stage: 's2', co: 'co4', lc: null, lr: iso(2000), chg: null, kind: null, cl: '[]' },
		{ title: 'Customer Onboarding — Harbor Legal Group', status: 'in_progress', sort: 2, priority: 3, due: dayOffset(5, 0).slice(0, 10), source: 'ticket', hs_id: 'h5', pipe: 'pipe-onb', stage: 'o3', co: 'co1', lc: null, lr: null, chg: null, kind: null, cl: '[{"id":"a","text":"Intake agent","done":true},{"id":"b","text":"Chase agent","done":false},{"id":"c","text":"Reception agent","done":false}]' },
		{ title: 'Customer Onboarding — Summit Injury Law', status: 'testing', sort: 2, priority: 2, due: null, source: 'ticket', hs_id: 'h6', pipe: 'pipe-onb', stage: 'o4', co: 'co2', lc: null, lr: null, chg: null, kind: null, cl: '[]' },
		{ title: 'Customer Onboarding — Brightline Family Law', status: 'kickoff_scheduled', sort: 2, priority: 0, due: null, source: 'ticket', hs_id: 'h7', pipe: 'pipe-onb', stage: 'o2', co: 'co3', lc: null, lr: null, chg: null, kind: null, cl: '[]' },
		{ title: 'Write launch announcement', status: 'todo', sort: 3, priority: 2, due: dayOffset(0, 0).slice(0, 10), source: 'manual', hs_id: null, pipe: null, stage: null, co: null, lc: null, lr: null, chg: null, kind: null, cl: '[{"id":"a","text":"Outline","done":true},{"id":"b","text":"Draft","done":false}]' },
		{ title: 'Renew SSL certs', status: 'todo', sort: 4, priority: 4, due: dayOffset(-1, 0).slice(0, 10), source: 'manual', hs_id: null, pipe: null, stage: null, co: null, lc: null, lr: null, chg: null, kind: null, cl: '[]' },
		{ title: 'Prep QBR slides', status: 'in_progress', sort: 3, priority: 1, due: null, source: 'manual', hs_id: null, pipe: null, stage: null, co: 'co2', lc: null, lr: null, chg: null, kind: null, cl: '[]' },
		{ title: 'Migrate voice prompts to new TTS', status: 'done', sort: 1, priority: 0, due: null, source: 'manual', hs_id: null, pipe: null, stage: null, co: null, lc: null, lr: null, chg: null, kind: null, cl: '[]' }
	];
	for (const r of rows) t.run({ ...r, now });
}

// ticket activity for the card panel
export const demoActivity: Record<string, { items: unknown[]; contact: unknown }> = {
	h1: {
		contact: { id: 'p1', email: 'maria@harborlegal.example', name: 'Maria Chen' },
		items: [
			{ id: 'n1', kind: 'note', at: iso(300), author: 'Client (portal)', body: 'After-hours callers are being transferred back to their own number. Happened twice yesterday — screenshot attached.', portal: true, attachments: [] },
			{ id: 'e1', kind: 'email', at: iso(240), author: 'Alex Rivera', subject: 'Transfer issue', body: 'Thanks Maria — found it. The after-hours rule was evaluating in UTC. Fix is going out this afternoon; I\'ll confirm once it\'s live.', portal: false, direction: 'EMAIL', attachments: [] },
			{ id: 'n2', kind: 'note', at: iso(200), author: 'Sam Okafor', body: 'Regression test added for the timezone branch.', portal: false, attachments: [] },
			{ id: 'n3', kind: 'note', at: iso(35), author: 'Client (portal)', body: 'Confirmed working on our end. One more thing: can the fallback prompt read the callback number twice?', portal: true, attachments: [] }
		]
	}
};
