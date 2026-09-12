// Phase 5 of docs/acs-calling-sow.md — media on top of the call engine.
//
// Split out of engine.svelte.ts because that file owns *lifecycle* (agent, token, tab lock, call
// state) and this owns *pixels and devices*: renderers, video tiles, screen share, effects.
//
// The single rule that matters here: every VideoStreamRenderer must be disposed. Streams come and go
// as people turn cameras on, leave, or get downgraded by OptimalVideoCount, and an undisposed
// renderer keeps decoding — the leak the SOW calls out by name.
import type {
	LocalVideoStream,
	RemoteParticipant,
	RemoteVideoStream,
	VideoStreamRenderer,
	VideoStreamRendererView
} from '@azure/communication-calling';
import type { CommunicationIdentifier } from '@azure/communication-common';

export type Tile = {
	key: string;
	/** Entra object id when the participant is a Teams user; null for anything else. */
	id: string | null;
	name: string;
	/** null while the participant has no video: the UI draws an avatar instead. */
	view: VideoStreamRendererView | null;
	muted: boolean;
	speaking: boolean;
	hand: boolean;
};

type Held = { renderer: VideoStreamRenderer; view: VideoStreamRendererView };

/** Renders one remote stream and remembers enough to tear it down again. */
export class Renderers {
	#held = new Map<string, Held>();

	key(participantKey: string, streamId: number) {
		return `${participantKey}:${streamId}`;
	}

	async attach(participantKey: string, stream: RemoteVideoStream): Promise<VideoStreamRendererView | null> {
		const k = this.key(participantKey, stream.id);
		const existing = this.#held.get(k);
		if (existing) return existing.view;
		let renderer: VideoStreamRenderer | null = null;
		try {
			const { VideoStreamRenderer } = await import('@azure/communication-calling');
			renderer = new VideoStreamRenderer(stream);
			const view = await renderer.createView({ scalingMode: 'Crop' });
			// the stream may have stopped while we were awaiting; don't leak the renderer we just made
			if (!stream.isAvailable) {
				view.dispose();
				renderer.dispose();
				return null;
			}
			this.#held.set(k, { renderer, view });
			return view;
		} catch (e) {
			// createView failed: this renderer never reaches #held, so dispose it here or it leaks
			renderer?.dispose();
			console.warn('[calls] could not render a video stream:', e);
			return null;
		}
	}

	detach(k: string) {
		const h = this.#held.get(k);
		if (!h) return;
		h.view.dispose();
		h.renderer.dispose();
		this.#held.delete(k);
	}

	/** Drop anything not in `keep` — participants who left, or streams we stopped subscribing to. */
	prune(keep: Set<string>) {
		for (const k of [...this.#held.keys()]) if (!keep.has(k)) this.detach(k);
	}

	disposeAll() {
		this.prune(new Set());
	}
}

// @azure/communication-common's getIdentifierRawId, handed over by the engine once the SDK has loaded
// (it lives in a lazily imported chunk; everything that builds keys runs after that).
let rawIdOf: ((id: CommunicationIdentifier) => string) | null = null;
export const setRawId = (fn: (id: CommunicationIdentifier) => string) => (rawIdOf = fn);

/**
 * Stable identity across events and call features. The same person arrives in different shapes — a
 * participant's `kind`-tagged identifier, a raised hand's plain one — so JSON of the object didn't match
 * and hands / the dominant-speaker ring likely never lit. The raw id ("8:orgid:…") is the same in both.
 */
export const identityKey = (id: unknown): string => {
	try {
		if (rawIdOf) return rawIdOf(id as CommunicationIdentifier);
	} catch { /* an identifier shape the SDK doesn't know: fall back below */ }
	return JSON.stringify(id);
};
export const participantKey = (p: RemoteParticipant) => identityKey(p.identifier);

/** The Entra object id, when this participant is a Teams user rather than a phone or app. */
export const teamsUserId = (p: RemoteParticipant): string | null => {
	const i = p.identifier as { microsoftTeamsUserId?: string };
	return typeof i?.microsoftTeamsUserId === 'string' ? i.microsoftTeamsUserId : null;
};

/** Local preview, used by both the pre-join screen and the in-call PiP. */
export class LocalPreview {
	#renderer: VideoStreamRenderer | null = null;
	view: VideoStreamRendererView | null = null;

	async start(stream: LocalVideoStream) {
		await this.stop();
		const { VideoStreamRenderer } = await import('@azure/communication-calling');
		this.#renderer = new VideoStreamRenderer(stream);
		// mirrored: people expect their own preview to behave like a mirror, not a photograph
		this.view = await this.#renderer.createView({ scalingMode: 'Crop', isMirrored: true });
		return this.view;
	}

	async stop() {
		this.view?.dispose();
		this.#renderer?.dispose();
		this.view = null;
		this.#renderer = null;
	}
}

/**
 * A rough mic level for the pre-join meter. WebAudio rather than the SDK because we want a reading
 * before any call exists, from a plain getUserMedia stream.
 */
export class MicMeter {
	#ctx: AudioContext | null = null;
	#stream: MediaStream | null = null;
	#raf = 0;
	#gen = 0; // bumped by every start/stop; a start whose getUserMedia resolves late drops its stream
	level = 0;

	async start(deviceId?: string, onLevel?: (v: number) => void) {
		const gen = ++this.#gen;
		await this.#release();
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: deviceId ? { deviceId: { exact: deviceId } } : true
		});
		if (gen !== this.#gen) return stream.getTracks().forEach((t) => t.stop());
		this.#stream = stream;
		this.#ctx = new AudioContext();
		const src = this.#ctx.createMediaStreamSource(this.#stream);
		const analyser = this.#ctx.createAnalyser();
		analyser.fftSize = 512;
		src.connect(analyser);
		const buf = new Uint8Array(analyser.frequencyBinCount);
		const tick = () => {
			analyser.getByteTimeDomainData(buf);
			let peak = 0;
			for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
			this.level = Math.min(1, peak / 64);
			onLevel?.(this.level);
			this.#raf = requestAnimationFrame(tick);
		};
		tick();
	}

	async stop() {
		this.#gen++;
		await this.#release();
	}

	async #release() {
		cancelAnimationFrame(this.#raf);
		this.#stream?.getTracks().forEach((t) => t.stop());
		await this.#ctx?.close().catch(() => {});
		this.#ctx = null;
		this.#stream = null;
		this.level = 0;
	}
}
