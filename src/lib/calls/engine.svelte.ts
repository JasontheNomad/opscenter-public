// Phase 2 of docs/acs-calling-sow.md — the call engine.
//
// One CallClient + TeamsCallAgent + DeviceManager for the whole app, behind a dynamic import so the
// browser-only Calling SDK never reaches the server bundle. Everything the UI needs is exposed as
// runes; no component talks to the SDK directly.
//
// Two constraints worth remembering here:
//  - The SDK refuses any origin that isn't https, file: or the literal host `localhost` — see the
//    Phase 0 note in the SOW. Reaching the app on 127.0.0.1 fails at createTeamsCallAgent.
//  - One agent per user. A second tab creating its own agent steals the registration and both tabs
//    ring unreliably, so the agent lives behind a Web Lock: one holder, freed when its tab dies.
// CTE hands back the Teams-flavoured types: TeamsCallAgent/TeamsCall, not CallAgent/Call.
import type { AudioDeviceInfo, CallClient, DeviceManager, JoinCallOptions, LocalVideoStream, RemoteParticipant, RemoteVideoStream, StartTeamsGroupCallOptions, TeamsCall, TeamsCallAgent, TeamsIncomingCall, TeamsMeetingLinkLocator, VideoDeviceInfo } from '@azure/communication-calling';
import type { MicrosoftTeamsUserIdentifier } from '@azure/communication-common';
import { LocalPreview, Renderers, identityKey, participantKey, setRawId, teamsUserId, type Tile } from './media';
import { errMsg } from '$lib/api';
import { startError, endReason } from './errors';

const PREF_KEY = 'ocCallDevices'; // remembered mic/camera/speaker, per the SOW
const CAMERA_KEY = 'ocCallCamera'; // camera on/off for meetings; on unless turned off last time

export type Phase = 'idle' | 'starting' | 'ready' | 'blocked' | 'error';
export type PermissionState = 'unknown' | 'granted' | 'denied';

const LOCK = 'opscenter-calls';
// Every minute of our call leg bills ($0.004). Alone this long — a forgotten meeting — we leave.
const ALONE_MS = 30 * 60_000;
// One call on screen. Dialling or joining a second used to replace the first on screen while it kept
// running — still billing, mic still open — with nothing left to hang it up.
const ALREADY_IN_CALL = "You're already in a call. Hang up first.";
// which call-quality warning wins when several are active (most actionable first)
const DIAG_ORDER = ['noNetwork', 'networkReconnect', 'microphonePermissionDenied', 'microphoneNotFunctioning'];

class Engine {
	phase = $state<Phase>('idle');
	/** `deeplink` = hand off to the Teams app (today's behaviour); `acs` = call in-app. Server-owned. */
	mode = $state<'acs' | 'deeplink'>('deeplink');
	configured = $state(false);
	error = $state<string | null>(null);
	mic = $state<PermissionState>('unknown');

	/** Live call, mirrored into runes — the SDK's own objects are not reactive. */
	callState = $state<string>('None');
	muted = $state(false);
	/** A queue, not a slot: a second call arriving mid-call must never be silently dropped. */
	incoming = $state<{ id: string; name: string; callerId: string | null }[]>([]);

	/** Connection trouble worth telling the user about, cleared when things recover. */
	warning = $state<string | null>(null);
	/** Why the last call ended, in plain language. Null when it ended normally. */
	endedBecause = $state<string | null>(null);
	/** Why the last call attempt went to the Teams app although calling is meant to run in OpsCenter. */
	handoff = $state<string | null>(null);

	/** People held in a Teams meeting lobby, and whether we're allowed to let them in. */
	lobby = $state<{ key: string; name: string }[]>([]);
	role = $state<string>('');
	canAdmit = $derived(this.role === 'Organizer' || this.role === 'Presenter' || this.role === 'Co-organizer');

	/** One tile per participant, video or avatar. Rebuilt whenever streams or people change. */
	tiles = $state<Tile[]>([]);
	videoOn = $state(false);
	sharing = $state(false);
	handRaised = $state(false);
	onHold = $state(false);
	/** From User Facing Diagnostics: null when fine, else something the user can act on. */
	quality = $state<string | null>(null);
	/** How many remote videos this machine should render right now. */
	optimalVideoCount = $state(4);
	blur = $state(false);
	/** A call held at the pre-join screen. The layout renders PreJoin whenever this is set. */
	pending = $state<{ title: string; sub: string; video: boolean; remember: boolean } | null>(null);
	/** The Teams chat this call belongs to, when there is one — drives the in-call chat panel. */
	chatId = $state<string | null>(null);
	selected = $state<{ mic?: string; camera?: string; speaker?: string }>({});

	mics = $state<AudioDeviceInfo[]>([]);
	speakers = $state<AudioDeviceInfo[]>([]);
	cameras = $state<VideoDeviceInfo[]>([]);

	inCall = $derived(this.callState !== 'None' && this.callState !== 'Disconnected');

	#client: CallClient | null = null;
	#agent: TeamsCallAgent | null = null;
	#devices: DeviceManager | null = null;
	#call: TeamsCall | null = null;
	/** Calls parked by "answer while in a call". The newest comes back (on hold) when the current one ends. */
	#held: TeamsCall[] = [];
	#incomingCalls = new Map<string, TeamsIncomingCall>();
	#ring: Ringer | null = null;
	#onIncoming: ((c: { id: string; name: string }) => void) | null = null;
	#openWindow: ((title: string) => boolean) | null = null;
	#local: LocalVideoStream | null = null;
	#lobbyRefs = new Map<string, RemoteParticipant>();
	#renderers = new Renderers();
	#preview = new LocalPreview();
	#tileSubs: (() => void)[] = [];
	#pendingRun: ((o: { video: boolean }) => unknown) | null = null;
	#holder = false;
	#unlock: (() => void) | null = null;
	#waiting = false;
	#listening = false;
	#tilesBusy = false;
	#tilesAgain = false;
	#diag = new Map<string, string>(); // active call-quality warnings, by diagnostic
	#aloneTimer: ReturnType<typeof setInterval> | null = null;
	#aloneSince: number | null = null;
	#autoLeft = false;
	#starting: Promise<void> | null = null;
	#config: Promise<void> | null = null;

	// ---- one agent across tabs. A Web Lock rather than a message-based election: the browser grants
	// it to exactly one tab and frees it when that tab closes or crashes, so there's no race to lose.
	#claim(): Promise<boolean> {
		const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
		if (!locks) return Promise.resolve(true);
		return new Promise((resolve) => {
			void locks.request(LOCK, { ifAvailable: true }, (lock) => {
				if (!lock) return resolve(false);
				this.#holder = true;
				resolve(true);
				return new Promise<void>((r) => (this.#unlock = r)); // held until #release()
			});
		});
	}
	#release() {
		this.#holder = false;
		this.#unlock?.();
		this.#unlock = null;
	}
	/** A blocked tab queues for the lock and retries once the holder lets go. */
	#awaitTurn() {
		if (this.#waiting || typeof navigator === 'undefined' || !navigator.locks) return;
		this.#waiting = true;
		void navigator.locks.request(LOCK, () => {}).then(() => {
			this.#waiting = false;
			if (this.phase === 'blocked') void this.start();
		});
	}
	/**
	 * The SDK reconnects on its own, but a laptop that slept long enough comes back with a dead
	 * registration and no event to say so — re-check whenever the machine or the tab wakes. Once per
	 * page, not per start, or every revive would add another pair.
	 */
	#listen() {
		if (this.#listening) return;
		this.#listening = true;
		addEventListener('online', () => void this.#revive());
		addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.#revive(); });
		addEventListener('pagehide', () => {
			// quitting, reloading or closing OpsCenter: end calls explicitly rather than leaving the
			// service to notice a dead connection, which bills until it does. Best effort — the page
			// may be gone before the hang-up reaches the service.
			for (const c of [this.#call, ...this.#held]) { try { void c?.hangUp(); } catch { /* going anyway */ } }
		});
	}

	/** Read CALLS_ENGINE once. Cheap enough to await from any component that shows a call button. */
	loadConfig(): Promise<void> {
		return (this.#config ??= (async () => {
			try {
				const r = await fetch('/api/calls/config');
				if (!r.ok) throw new Error(`config ${r.status}`);
				const j = await r.json();
				this.mode = j.engine === 'acs' ? 'acs' : 'deeplink';
				this.configured = !!j.configured;
			} catch {
				this.mode = 'deeplink'; // a config we can't read is a config we don't trust with a call
				this.#config = null; // …this time: a blip used to pin the whole page to the Teams hand-off
			}
		})());
	}

	/**
	 * Call sites, when they fall back to the Teams app: say why, if calling was meant to happen here —
	 * the engine's reason used to be lost and the click simply opened Teams. Shown by CallNotices.
	 */
	noteHandoff() {
		if (this.mode !== 'acs' || !this.configured) return; // the hand-off is the configured behaviour
		this.handoff = this.error ?? "Calling in OpsCenter isn't available right now.";
	}

	/** True when this build should place calls in-app rather than handing off to the Teams client. */
	async inApp(): Promise<boolean> {
		await this.loadConfig();
		if (this.mode !== 'acs' || !this.configured) return false;
		await this.start();
		return this.phase === 'ready';
	}

	/** Idempotent. Safe to call from every component that might need calling. */
	start(): Promise<void> {
		return (this.#starting ??= this.#start().finally(() => { this.#starting = null; }));
	}

	async #start() {
		if (this.phase === 'ready') return;
		this.#listen();
		this.error = null;
		this.phase = 'starting';
		try {
			if (!(await this.#claim())) {
				this.phase = 'blocked';
				this.error = 'OpsCenter is handling calls in another window.';
				this.#awaitTurn();
				return;
			}

			const r = await fetch('/api/calls/token');
			const j = await r.json();
			if (!r.ok) throw new Error(j.error ?? `token ${r.status}`);

			const { CallClient } = await import('@azure/communication-calling');
			const { AzureCommunicationTokenCredential, getIdentifierRawId } = await import('@azure/communication-common');
			setRawId(getIdentifierRawId);

			this.#client = new CallClient();
			const cred = new AzureCommunicationTokenCredential({
				token: j.token,
				// the server caches and re-mints at 80% of TTL; the SDK just asks again
				// Runs mid-call. A single failed fetch (wifi blip, service restart) must not end a call, so
				// retry with backoff before handing the SDK an error it will act on.
				tokenRefresher: async () => {
					let last: unknown;
					for (let i = 0; i < 3; i++) {
						try {
							const res = await fetch('/api/calls/token');
							const body = await res.json();
							if (!res.ok) throw new Error(body.error ?? `token ${res.status}`);
							this.warning = null;
							return body.token as string;
						} catch (e) {
							last = e;
							this.warning = 'Reconnecting…';
							await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
						}
					}
					throw last instanceof Error ? last : new Error(String(last));
				},
				refreshProactively: true
			});
			this.#agent = await this.#client.createTeamsCallAgent(cred);
			this.#agent.on('incomingCall', ({ incomingCall }) => {
				const id = incomingCall.id;
				const caller = incomingCall.callerInfo?.identifier;
				this.#incomingCalls.set(id, incomingCall);
				const entry = {
					id,
					name: incomingCall.callerInfo?.displayName ?? 'Unknown',
					callerId: caller && 'microsoftTeamsUserId' in caller ? (caller.microsoftTeamsUserId as string) : null
				};
				this.incoming = [...this.incoming, entry];
				// caller gave up, or it was answered on another device — drop it without a trace
				incomingCall.on('callEnded', () => this.#drop(id));
				this.#onIncoming?.(entry);
				this.#ring ??= new Ringer();
				this.#ring.start();
			});

			this.#devices = await this.#client.getDeviceManager();
			await this.#refreshDevices();
			this.#loadPrefs();
			if (this.selected.mic) void this.selectMic(this.selected.mic);
			if (this.selected.speaker) void this.selectSpeaker(this.selected.speaker);
			this.#devices.on('audioDevicesUpdated', () => void this.#refreshDevices());
			this.#devices.on('videoDevicesUpdated', () => void this.#refreshDevices());

			this.#agent.on('connectionStateChanged', (a: unknown) => {
				const v = typeof a === 'string' ? a : (a as { newValue?: string })?.newValue;
				this.warning = v === 'Disconnected' ? 'Reconnecting…' : null;
			});

			this.phase = 'ready';
		} catch (e) {
			this.phase = 'error';
			this.error = startError(e);
			// don't sit on a half-built agent or the lock: another tab, or the next revive, starts clean
			try { await this.#agent?.dispose(); } catch { /* never registered */ }
			this.#agent = null;
			this.#client = null;
			this.#devices = null;
			if (this.#holder) this.#release();
		}
	}

	/**
	 * Liveness check after a wake or a network return: rebuild a dead agent, and retry one that never
	 * started (woke with the network down). Rebuilding mid-call would drop the call, so an active call
	 * is left to the SDK's own reconnect.
	 */
	/** Call from a user gesture: unlocks the ringtone's audio for calls that arrive later. */
	primeAudio() {
		(this.#ring ??= new Ringer()).prime();
	}
	// One at a time: a wake fires `online` and `visibilitychange` together, and a second dispose() landing
	// after the first's start() re-claimed the Web Lock would release it under a live agent.
	#reviving: Promise<void> | null = null;
	#revive(): Promise<void> {
		return (this.#reviving ??= this.#reviveOnce().finally(() => (this.#reviving = null)));
	}
	async #reviveOnce() {
		if (this.inCall) return;
		if (this.phase === 'ready') {
			if (this.#agent?.connectionState !== 'Disconnected') return;
		} else if (this.phase !== 'error') return;
		this.warning = 'Reconnecting…';
		await this.dispose();
		await this.start();
		this.warning = null; // ready, or `error` says why not
	}
	async #refreshDevices() {
		if (!this.#devices) return;
		this.mics = await this.#devices.getMicrophones();
		this.speakers = await this.#devices.getSpeakers();
		this.cameras = await this.#devices.getCameras();
	}

	// ---- pre-join

	/**
	 * Hold a call at the pre-join screen instead of dialling immediately. Call sites hand over what
	 * they would have done; PreJoin decides mic/camera/blur first and then runs it.
	 */
	/**
	 * `video` is an explicit choice (the chat menu's Audio / Video call). Left out — meetings — the
	 * camera starts however it was last time, on by default, and what you join with is remembered.
	 */
	prepare(title: string, run: (o: { video: boolean }) => unknown, video?: boolean, sub = '') {
		if (this.inCall) {
			// one outgoing call at a time — bring the live one forward and say why
			this.error = ALREADY_IN_CALL;
			this.#openWindow?.('In a call');
			return;
		}
		const remember = video === undefined;
		this.error = null; // whatever went wrong last call isn't news on this one
		this.handoff = null;
		this.pending = { title, sub, video: video ?? this.#cameraPref(), remember };
		this.#pendingRun = run;
		this.#openWindow?.(title); // still inside the click that got us here, so the popup is allowed
	}

	async confirmPending(o: { video: boolean }) {
		const run = this.#pendingRun;
		if (!run) return;
		this.#pendingRun = null; // a second click while dialling does nothing
		this.error = null;
		try {
			await run(o);
		} catch (e) {
			// keep the dialog up with the reason (Join can retry); its Cancel turns the camera back off
			this.error = startError(e);
			this.#pendingRun = run;
			return;
		}
		if (this.pending?.remember) { try { localStorage.setItem(CAMERA_KEY, o.video ? 'on' : 'off'); } catch { /* private mode */ } }
		this.pending = null;
	}

	#cameraPref() {
		try { return localStorage.getItem(CAMERA_KEY) !== 'off'; } catch { return true; }
	}

	async cancelPending() {
		this.pending = null;
		this.#pendingRun = null;
		// the preview camera was opened for the dialog; don't leave the light on
		await this.stopVideo();
	}

	// ---- media (Phase 5). Renderers are the leak-prone part: every view created here is disposed in
	// #syncTiles' prune, in #teardown, or in dispose().

	/** Remembered device choices, applied whenever a call starts. */
	#loadPrefs() {
		try { this.selected = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}'); } catch { /* first run */ }
	}
	#savePrefs() {
		try { localStorage.setItem(PREF_KEY, JSON.stringify(this.selected)); } catch { /* private mode */ }
	}

	/** A user action from a button: a failure lands in `error`, shown in the call UI, instead of rejecting into a click handler nobody awaits. */
	async #act(fn: () => unknown, device: 'mic' | 'camera' = 'mic') {
		try {
			await fn();
		} catch (e) {
			this.error = startError(e, device);
		}
	}

	selectMic(id: string) {
		return this.#act(async () => {
			const d = this.mics.find((m) => m.id === id);
			if (d) { await this.#devices?.selectMicrophone(d); this.selected = { ...this.selected, mic: id }; this.#savePrefs(); }
		});
	}
	selectSpeaker(id: string) {
		return this.#act(async () => {
			const d = this.speakers.find((m) => m.id === id);
			if (d) { await this.#devices?.selectSpeaker(d); this.selected = { ...this.selected, speaker: id }; this.#savePrefs(); }
		});
	}
	selectCamera(id: string) {
		this.selected = { ...this.selected, camera: id };
		this.#savePrefs();
		// Swap the live stream's source in place. Stop-then-start was two queue entries a toggle could land
		// between (leaving the camera on after it was turned off), and people on the call saw video drop.
		return this.#camera(async () => {
			const cam = this.#pickCamera();
			if (!this.videoOn || !this.#local || !cam) return;
			await this.#local.switchSource(cam);
			if (this.blur) await this.#applyBlur(true);
		});
	}

	#pickCamera() {
		return this.cameras.find((c) => c.id === this.selected.camera) ?? this.cameras[0] ?? null;
	}

	// Camera on/off run one at a time, in order: a quick on-then-off in the pre-join dialog otherwise let
	// stop() land mid-start, leaving videoOn true with no stream (or a preview still holding the camera).
	#videoQ: Promise<unknown> = Promise.resolve();
	#queueVideo(op: () => Promise<void>): Promise<void> {
		const run = this.#videoQ.then(op);
		this.#videoQ = run.catch(() => {});
		return run;
	}
	// Opening a camera takes about a second, during which `videoOn` is still false — a second click on
	// the toolbar queued a second start, which the SDK refused ("video is already started") while the
	// first stream stayed live: people saw you, your own preview was black. The UI disables the button
	// while an op is in flight, and #startVideo below is idempotent as a second line of defence.
	#cameraOps = 0;
	cameraBusy = $state(false);
	#camera(op: () => Promise<void>) {
		this.#cameraOps++;
		this.cameraBusy = true;
		return this.#act(() => this.#queueVideo(op), 'camera').finally(() => {
			if (--this.#cameraOps === 0) this.cameraBusy = false;
		});
	}
	startVideo() { return this.#camera(() => this.#startVideo()); }
	stopVideo() { return this.#camera(() => this.#stopVideo()); }
	async #startVideo() {
		// already on: nothing to start. Re-show the preview in case an earlier failed start tore it down.
		if (this.videoOn && this.#local) {
			if (!this.#preview.view) await this.#preview.start(this.#local);
			return;
		}
		const cam = this.#pickCamera();
		if (!cam) { this.error = 'No camera was found.'; return; }
		const { LocalVideoStream } = await import('@azure/communication-calling');
		const stream = new LocalVideoStream(cam);
		// #local only once the camera is really on: set first, a busy or denied camera left a dead stream
		// behind that the next join then handed to the call
		await this.#preview.start(stream);
		try {
			if (this.#call) await this.#call.startVideo(stream);
		} catch (e) {
			await this.#preview.stop();
			// The call already has video that we lost track of. Adopt the SDK's own stream — switching
			// camera and stopping video must act on the live one — and show it, rather than leaving the
			// self-view black while everyone else sees the picture.
			const live = /already started/i.test(errMsg(e))
				? (this.#call?.localVideoStreams.find((v) => v.mediaStreamType === 'Video') ?? null)
				: null;
			if (live) {
				this.#local = live;
				this.videoOn = true;
				await this.#preview.start(live);
				void this.#syncTiles();
				return;
			}
			throw e;
		}
		this.#local = stream;
		if (this.blur) await this.#applyBlur(true);
		this.videoOn = true;
		void this.#syncTiles();
	}

	async #stopVideo() {
		try { if (this.#call && this.#local) await this.#call.stopVideo(this.#local); } catch { /* already stopped */ }
		await this.#preview.stop();
		this.#local = null;
		this.videoOn = false;
		void this.#syncTiles();
	}

	/** The local preview view, for the PiP and the pre-join screen. */
	get previewView() { return this.#preview.view; }

	async setBlur(on: boolean) {
		this.blur = on;
		if (this.videoOn) await this.#applyBlur(on);
	}

	async #applyBlur(on: boolean) {
		if (!this.#local) return;
		try {
			const { Features } = await import('@azure/communication-calling');
			const effects = this.#local.feature(Features.VideoEffects);
			if (!on) { await effects.stopEffects(); return; }
			// separate package: the segmentation model is large, so it loads only when blur is used
			const { BackgroundBlurEffect } = await import('@azure/communication-calling-effects');
			const effect = new BackgroundBlurEffect();
			if (await effects.isSupported(effect)) await effects.startEffects(effect);
			else this.error = 'Background blur is not supported on this machine.';
		} catch (e) {
			this.error = startError(e);
		}
	}

	async startScreenShare() {
		if (!this.#call) return;
		this.error = null;
		// the SDK refuses before media is up; say so plainly instead of surfacing its error
		if (this.#call.state !== 'Connected') { this.error = 'Screen sharing can start once the call has connected.'; return; }
		try {
			await this.#call.startScreenSharing();
			this.sharing = true;
		} catch (e) {
			// the picker being dismissed is a normal outcome, not an error worth showing
			const m = errMsg(e);
			if (!/Permission denied|NotAllowedError|cancel/i.test(m)) this.error = startError(e);
		}
	}
	async stopScreenShare() {
		try { await this.#call?.stopScreenSharing(); } catch { /* already stopped */ }
		this.sharing = false;
	}

	raiseHand() {
		return this.#act(async () => {
			const { Features } = await import('@azure/communication-calling');
			const f = this.#call?.feature(Features.RaiseHand);
			if (!f) return;
			if (this.handRaised) await f.lowerHand(); else await f.raiseHand();
			this.handRaised = !this.handRaised;
		});
	}

	hold() { return this.#act(async () => { await this.#call?.hold(); this.onHold = true; }); }
	resume() { return this.#act(async () => { await this.#call?.resume(); this.onHold = false; }); }

	/**
	 * Synchronous in the SDK — it returns the participant rather than a promise — so a failure throws
	 * here rather than rejecting later. `removeParticipant` is the inverse if it's ever needed.
	 */
	addParticipant(objectId: string) {
		if (!this.#call) throw new Error('Not in a call.');
		const p = this.#call.addParticipant({ microsoftTeamsUserId: objectId } satisfies MicrosoftTeamsUserIdentifier);
		void this.#syncTiles();
		return p;
	}

	/**
	 * Rebuild the tile list from the call's current participants and streams, creating renderers for
	 * newly visible video and disposing everything no longer on screen. This is the only place that
	 * creates remote renderers, so it is also the only place that has to remember to free them.
	 *
	 * Only the first `optimalVideoCount` remote videos are rendered — decoding more than the machine
	 * can handle degrades every stream, which is what OptimalVideoCount exists to prevent.
	 */
	async #syncTiles() {
		// Many events fire at once (speaking, mute, streams, OVC). Two overlapping builds would both
		// create a renderer for the same stream and orphan one, so run one at a time and coalesce.
		if (this.#tilesBusy) { this.#tilesAgain = true; return; }
		this.#tilesBusy = true;
		try {
			do { this.#tilesAgain = false; await this.#buildTiles(); } while (this.#tilesAgain);
		} catch (e) {
			// fired from SDK events with nobody awaiting: a throw here would be an unhandled rejection
			console.warn('[calls] tile update failed:', e);
		} finally {
			this.#tilesBusy = false;
		}
	}

	async #buildTiles() {
		const call = this.#call;
		if (!call) { this.#renderers.disposeAll(); this.tiles = []; return; }

		const { Features } = await import('@azure/communication-calling');
		const hands = new Set((call.feature(Features.RaiseHand).getRaisedHands?.() ?? []).map((h) => identityKey(h.identifier)));
		const keep = new Set<string>();
		const next: Tile[] = [];
		let rendered = 0;

		for (const p of call.remoteParticipants as readonly RemoteParticipant[]) {
			const key = participantKey(p);
			// screen share first: if someone is presenting, that is what you want to see
			const streams = [...p.videoStreams].sort((a, b) => (a.mediaStreamType === 'ScreenSharing' ? -1 : 0) - (b.mediaStreamType === 'ScreenSharing' ? -1 : 0));
			const live = streams.find((v) => v.isAvailable);
			let view = null;
			if (live && rendered < this.optimalVideoCount) {
				const k = this.#renderers.key(key, live.id);
				view = await this.#renderers.attach(key, live);
				if (view) { keep.add(k); rendered++; }
			}
			next.push({
				key,
				id: teamsUserId(p),
				name: p.displayName ?? '',
				view,
				muted: p.isMuted,
				speaking: p.isSpeaking,
				hand: hands.has(key),
			});
		}

		// the call ended or changed while we awaited: what we attached belongs to no one on screen
		if (call !== this.#call) { this.#renderers.disposeAll(); this.#tilesAgain = true; return; }
		this.#renderers.prune(keep);
		this.tiles = next;
	}

	// ---- call lifecycle
	/**
	 * Attach a call's handlers, once, and put it on screen. Every handler ignores events unless its
	 * call is the one on screen: with "answer while in a call", a held call keeps firing events, and
	 * without that check its hangup would tear down the live call.
	 */
	#wire(call: TeamsCall) {
		const mine = () => call === this.#call;
		call.on('stateChanged', () => {
			if (call.state === 'Disconnected') {
				this.#held = this.#held.filter((c) => c !== call);
				if (!mine()) return; // a held call ended on its own
				this.#ring?.stopBack();
				this.callState = 'Disconnected';
				this.endedBecause = this.#autoLeft
					? 'You were the only one in the call for 30 minutes, so OpsCenter left it.'
					: endReason(call.callEndReason?.code, call.callEndReason?.subCode);
				this.#autoLeft = false;
				this.#teardown();
				// the call we parked to answer this one comes back, still on hold, for Resume
				const next = this.#held.pop();
				if (next) this.#activate(next);
				return;
			}
			if (!mine()) return;
			this.#sync();
			// ringback while the far end rings, so a placed call isn't silent (see Ringer.startBack)
			if (call.state === 'Ringing') (this.#ring ??= new Ringer()).startBack();
			else this.#ring?.stopBack();
			if (call.state === 'Connected') { this.warning = null; this.endedBecause = null; }
		});
		call.on('remoteParticipantsUpdated', (d: { added: RemoteParticipant[]; removed: RemoteParticipant[] }) => {
			if (!mine()) return;
			for (const p of d.added ?? []) this.#subscribe(p);
			this.#sync();
			void this.#syncTiles();
		});
		call.on('isMutedChanged', () => mine() && this.#sync());
		// sharing can also end from Brave's own "Stop sharing" bar, which never goes through stopScreenShare
		call.on('isScreenSharingOnChanged', () => {
			if (!mine()) return;
			this.sharing = call.isScreenSharingOn;
		});
		call.on('roleChanged', () => mine() && (this.role = call.role ?? ''));
		// Teams meetings can park people outside; surface them so the organiser can let them in.
		call.lobby?.on('lobbyParticipantsUpdated', () => mine() && this.#syncLobby());

		// features are memoized per call, so this is cheap. Each is wired on its own: one throwing used to
		// leave every feature after it (hands, diagnostics) silently unwired for the rest of the call.
		void (async () => {
			const { Features } = await import('@azure/communication-calling');
			const wire = (what: string, fn: () => void) => {
				try { fn(); } catch (e) { console.warn(`[calls] ${what} unavailable:`, e); }
			};

			wire('video count', () => {
				const ovc = call.feature(Features.OptimalVideoCount);
				const readOvc = () => {
					if (!mine()) return;
					this.optimalVideoCount = Math.max(1, ovc.optimalVideoCount);
					void this.#syncTiles();
				};
				ovc.on('optimalVideoCountChanged', readOvc);
				readOvc();
			});

			// (who's speaking comes from each participant's own isSpeaking — see #subscribe. The dominant-
			// speakers feed was a second writer of the same flag and the two disagreed, so the ring flickered.)

			// raised hands are read in #buildTiles; these just ask for a redraw
			wire('raised hands', () => {
				const hands = call.feature(Features.RaiseHand);
				const redraw = () => mine() && void this.#syncTiles();
				hands.on('raisedHandEvent', redraw);
				hands.on('loweredHandEvent', redraw);
			});

			// UFD turns 'the call feels bad' into something specific enough to act on. One entry per issue,
			// set and cleared by its own event: with a single slot, "Microphone not working" never cleared,
			// and a network recovery wiped a mic warning that was still true.
			const diag = (key: string, msg: string | null) => {
				if (!mine()) return;
				if (msg) this.#diag.set(key, msg); else this.#diag.delete(key);
				this.quality = DIAG_ORDER.map((k) => this.#diag.get(k)).find(Boolean) ?? null;
			};
			wire('diagnostics', () => {
				const ufd = call.feature(Features.UserFacingDiagnostics);
				ufd.network.on('diagnosticChanged', (d: { diagnostic: string; value: unknown; valueType: string }) => {
					const bad = d.valueType === 'DiagnosticQuality' ? Number(d.value) >= 2 : d.value === true;
					if (d.diagnostic === 'noNetwork') diag('noNetwork', bad ? 'No connection' : null);
					else if (d.diagnostic === 'networkReconnect') diag('networkReconnect', bad ? 'Poor connection' : null);
				});
				ufd.media.on('diagnosticChanged', (d: { diagnostic: string; value: unknown }) => {
					if (d.diagnostic === 'microphonePermissionDenied') diag('microphonePermissionDenied', d.value === true ? 'Microphone blocked' : null);
					else if (d.diagnostic === 'microphoneNotFunctioning') diag('microphoneNotFunctioning', d.value === true ? 'Microphone not working' : null);
				});
			});
		})();

		// Closing the tab mid-call kills it with no warning; make the browser ask first.
		const guard = (e: BeforeUnloadEvent) => { if (this.inCall) e.preventDefault(); };
		addEventListener('beforeunload', guard);
		call.on('stateChanged', () => { if (call.state === 'Disconnected') removeEventListener('beforeunload', guard); });

		this.#activate(call);
		return call;
	}

	/** Make `call` the one on screen: participants, lobby, state and tiles all follow it. */
	#activate(call: TeamsCall) {
		this.#call = call;
		this.#watchAlone();
		// A meeting knows its own thread. A 1:1 or group call doesn't tell the service about the chat
		// (see the accepted limits), but we still know which chat we dialled from, so keep whichever
		// the call site already set.
		this.chatId = call.info?.threadId ?? this.chatId;
		for (const p of call.remoteParticipants as readonly RemoteParticipant[]) this.#subscribe(p);
		this.#syncLobby();
		this.#sync();
		// the call can already be ringing by the time we wire it, and that first event is then never seen
		if (call.state === 'Ringing') (this.#ring ??= new Ringer()).startBack();
		else this.#ring?.stopBack();
		void this.#syncTiles();
	}

	/** Mirror the on-screen call into runes — the SDK's own objects are not reactive. */
	#sync() {
		const call = this.#call;
		if (!call) return;
		this.callState = call.state;
		this.onHold = call.state === 'LocalHold';
		this.role = call.role ?? '';
		this.muted = call.isMuted;
	}

	#syncLobby() {
		this.#lobbyRefs.clear();
		this.lobby = (this.#call?.lobby?.participants ?? []).map((p: RemoteParticipant) => {
			const key = identityKey(p.identifier);
			this.#lobbyRefs.set(key, p);
			return { key, name: p.displayName ?? 'Someone' };
		});
	}

	/** Each participant's own stream/mute/speaking events, unsubscribed in #teardown. */
	#subscribe(p: RemoteParticipant) {
		// streams changing needs renderers: rebuild. Speaking / muted only change a flag on one tile — they
		// fire constantly, and a full rebuild on each re-ran every attach for every participant.
		const redraw = () => void this.#syncTiles();
		const patch = () => {
			const key = participantKey(p);
			this.tiles = this.tiles.map((t) => (t.key === key ? { ...t, muted: p.isMuted, speaking: p.isSpeaking } : t));
		};

		// Someone turning their camera on *during* a call keeps the same RemoteVideoStream object, so
		// `videoStreamsUpdated` never fires again — only the stream's own `isAvailableChanged` does, and
		// #buildTiles only renders a stream once `isAvailable` is true. Without this their video never
		// appeared (verified on a real call 2026-09-11).
		const watched = new Map<number, () => void>();
		const watch = (s: RemoteVideoStream) => {
			if (watched.has(s.id)) return;
			const avail = () => void this.#syncTiles();
			s.on('isAvailableChanged', avail);
			watched.set(s.id, () => s.off('isAvailableChanged', avail));
		};
		const unwatch = (s: RemoteVideoStream) => {
			watched.get(s.id)?.();
			watched.delete(s.id);
		};
		for (const s of p.videoStreams) watch(s);
		const streams = (d: { added?: RemoteVideoStream[]; removed?: RemoteVideoStream[] }) => {
			for (const s of d?.added ?? []) watch(s);
			for (const s of d?.removed ?? []) unwatch(s);
			redraw();
		};

		p.on('videoStreamsUpdated', streams);
		p.on('isMutedChanged', patch);
		p.on('isSpeakingChanged', patch);
		this.#tileSubs.push(() => {
			p.off('videoStreamsUpdated', streams);
			p.off('isMutedChanged', patch);
			p.off('isSpeakingChanged', patch);
			for (const off of watched.values()) off();
			watched.clear();
		});
	}

	/** Checked once a minute: nobody else in the call (or waiting in its lobby) for ALONE_MS → leave. */
	#watchAlone() {
		this.#aloneSince = null;
		if (this.#aloneTimer) return;
		this.#aloneTimer = setInterval(() => {
			const call = this.#call;
			if (!call) return;
			const alone = call.remoteParticipants.length === 0 && this.lobby.length === 0;
			if (!alone) { this.#aloneSince = null; return; }
			this.#aloneSince ??= Date.now();
			if (Date.now() - this.#aloneSince >= ALONE_MS) {
				this.#autoLeft = true;
				void call.hangUp().catch(() => {});
			}
		}, 60_000);
	}

	#teardown() {
		this.#ring?.stopBack();
		if (this.#aloneTimer) { clearInterval(this.#aloneTimer); this.#aloneTimer = null; }
		for (const off of this.#tileSubs) off();
		this.#tileSubs = [];
		this.#renderers.disposeAll();
		void this.#preview.stop();
		this.tiles = [];
		this.videoOn = false;
		this.sharing = false;
		this.handRaised = false;
		this.onHold = false;
		this.quality = null;
		this.#diag.clear();
		this.chatId = null;
		this.#call = null;
		this.lobby = [];
		this.role = '';
		this.#lobbyRefs.clear();
		this.#local = null;
	}

	admit(key: string) {
		return this.#act(async () => {
			const p = this.#lobbyRefs.get(key);
			if (p) await this.#call?.lobby?.admit(p.identifier);
		});
	}
	admitAll() { return this.#act(() => this.#call?.lobby?.admitAll()); }
	rejectFromLobby(key: string) {
		return this.#act(async () => {
			const p = this.#lobbyRefs.get(key);
			if (p) await this.#call?.lobby?.reject(p.identifier);
		});
	}

	/**
	 * `ids` are Entra object ids.
	 *
	 * `threadId` only exists on `StartTeamsGroupCallOptions` — the SDK's 1:1 overload has no such
	 * field, and the service ignores it there. So a 1:1 call cannot be attached to its chat thread and
	 * shows up only in the callee's Teams Calls history; a group call carries the thread and appears
	 * in the chat. Only send it where it means something.
	 */
	startCall(ids: string[], opts: { video?: boolean; threadId?: string } = {}) {
		if (!this.#agent) throw new Error('call engine not started');
		if (this.inCall) throw new Error(ALREADY_IN_CALL);
		const participants: MicrosoftTeamsUserIdentifier[] = ids.map((id) => ({ microsoftTeamsUserId: id }));
		const group = participants.length > 1;
		this.chatId = opts.threadId ?? null;
		const options: StartTeamsGroupCallOptions = {
			audioOptions: { muted: false },
			...this.#videoOptions(opts.video),
			...(group && opts.threadId ? { threadId: opts.threadId } : {})
		};
		return this.#wire(this.#agent.startCall(participants, options));
	}

	join(meetingLink: string, video = false) {
		if (!this.#agent) throw new Error('call engine not started');
		if (this.inCall) throw new Error(ALREADY_IN_CALL);
		const locator: TeamsMeetingLinkLocator = { meetingLink };
		const options: JoinCallOptions = { audioOptions: { muted: false }, ...this.#videoOptions(video) };
		return this.#wire(this.#agent.join(locator, options));
	}

	/**
	 * PreJoin already started the camera to show a preview, so the call reuses that same stream rather
	 * than opening the device twice.
	 */
	#videoOptions(video?: boolean) {
		return video && this.#local ? { videoOptions: { localVideoStreams: [this.#local] } } : {};
	}
	/** Defaults to the oldest ringing call, so "Accept" with one call needs no argument. */
	async accept(id = this.incoming[0]?.id) {
		const c = id ? this.#incomingCalls.get(id) : null;
		if (!c) return;
		// before any await: a popup may only open from the click itself
		this.#openWindow?.(this.incoming.find((i) => i.id === id)?.name ?? 'Call');
		// a pre-join screen that was up is abandoned (and its preview camera turned off): this call takes
		// the window, otherwise it would sit hidden behind the dialog
		if (this.pending) await this.cancelPending();
		// answering while already connected: park the first call rather than losing it. It comes back
		// on hold when this one ends (see #wire).
		const prev = this.#call;
		const parked = !!prev && prev.state === 'Connected';
		if (parked) await prev.hold().catch(() => {});
		let call: TeamsCall;
		try {
			call = await c.accept();
		} catch (e) {
			// caller gave up, or media failed: say so (the call window shows it) and bring back the call we
			// parked to answer this one — otherwise the window sat on "Connecting…" with the reason lost
			this.error = startError(e);
			if (parked) await prev.resume().catch(() => {});
			return;
		}
		this.#drop(id!);
		if (prev && prev.state !== 'Disconnected') { this.#held.push(prev); this.#teardown(); }
		return this.#wire(call);
	}

	async decline(id = this.incoming[0]?.id) {
		const c = id ? this.#incomingCalls.get(id) : null;
		if (!c) return;
		await c.reject().catch(() => {});
		this.#drop(id!);
	}

	#drop(id: string) {
		this.#incomingCalls.delete(id);
		this.incoming = this.incoming.filter((i) => i.id !== id);
		if (!this.incoming.length) this.#ring?.stop();
	}

	/** Set by the UI so a banner can be raised without the engine importing anything DOM-shaped. */
	onIncoming(fn: (c: { id: string; name: string }) => void) {
		this.#onIncoming = fn;
		return () => { if (this.#onIncoming === fn) this.#onIncoming = null; };
	}
	/** Set by the UI: open the call's own window. Returns false if the browser refused (in-app instead). */
	onWindow(fn: (title: string) => boolean) { this.#openWindow = fn; }

	hangUp() { return this.#act(() => this.#call?.hangUp()); }
	mute() { return this.#act(() => this.#call?.mute()); }
	unmute() { return this.#act(() => this.#call?.unmute()); }

	/** Called on Teams sign-out and on page unload: give the agent back so another tab can take it. */
	async dispose() {
		this.#ring?.stop();
		this.#ring?.stopBack();
		for (const c of this.#incomingCalls.values()) await c.reject().catch(() => {});
		this.#incomingCalls.clear();
		this.incoming = [];
		try { await this.#call?.hangUp(); } catch { /* already gone */ }
		for (const c of this.#held) try { await c.hangUp(); } catch { /* already gone */ }
		this.#held = [];
		try { await this.#agent?.dispose(); } catch { /* already gone */ }
		this.#agent = null;
		this.#client = null;
		this.#devices = null;
		this.#teardown();
		this.callState = 'None';
		this.phase = 'idle';
		if (this.#holder) this.#release();
	}
}

/**
 * Ringtone without an asset: two tones a fifth apart on the classic ring cadence. The context is
 * unlocked by prime() on the app's first click or keypress (calls.primeAudio). A call that rings before
 * any interaction since launch is silent — browser autoplay rule — and relies on the OS notification.
 */
class Ringer {
	#ctx: AudioContext | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#back: ReturnType<typeof setInterval> | null = null;

	// Autoplay: an AudioContext made without a user gesture stays suspended and resume() can't wake it,
	// so the ring (which arrives from an SDK event, never a click) is created on the first interaction.
	prime() {
		this.#ctx ??= new AudioContext();
		void this.#ctx.resume();
	}
	start() {
		if (this.#timer) return;
		this.prime();
		const burst = () => { this.#tone(0, 440); this.#tone(0.45, 660); };
		burst();
		this.#timer = setInterval(burst, 3000);
	}

	/**
	 * Ringback — what *you* hear while the other end rings. Without it a placed call was silent and
	 * looked like nothing had happened. Quieter than the incoming ring and on the North American
	 * cadence (440 + 480 Hz, 2 s on, 4 s off) so the two are never confused.
	 */
	startBack() {
		if (this.#back) return;
		this.prime();
		const burst = () => { this.#tone(0, 440, 0.05, 2); this.#tone(0, 480, 0.05, 2); };
		burst();
		this.#back = setInterval(burst, 6000);
	}

	#tone(delay: number, freq: number, peak = 0.14, len = 0.35) {
		const ctx = this.#ctx;
		if (!ctx) return;
		const t = ctx.currentTime + delay;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = freq;
		// ramp both edges; a square-edged gain change clicks
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(peak, t + 0.02);
		gain.gain.setValueAtTime(peak, t + len - 0.05);
		gain.gain.linearRampToValueAtTime(0, t + len);
		osc.connect(gain).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + len + 0.05);
	}

	stop() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	stopBack() {
		if (this.#back) clearInterval(this.#back);
		this.#back = null;
	}
}

export const calls = new Engine();
