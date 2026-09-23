// Signal-processing pipeline for a stream of MediaPipe pose landmarks.
//
// Per-landmark preprocessing order (see PoseProcessor.applyFilters):
//   1. Confidence gate — reject below-threshold measurements BEFORE smoothing so
//      unreliable points never corrupt the filters; the filter coasts on its last
//      accepted estimate during the dropout.
//   2. One Euro filter (jitter/lag-adaptive smoothing) — optional.
//   3. Kalman filter   (random-walk smoothing)         — optional, stacked after.
// Normalization (0..1 vs raw pixels) and canonicalization are OUTPUT
// representations applied after smoothing, so filtering always runs in
// MediaPipe's native 0..1 space. The confidence threshold is additionally used
// at draw time to hide the rejected (coasted) landmarks from the overlay.
//
// One Euro and Kalman are independent switches and stack in that order when
// both are enabled. Filter state is keyed by (pose index, landmark index,
// coordinate); it is reset via reset() whenever the source or pose count
// changes so state from one clip/person does not leak into another.
//
// Coordinate labels (X/Y/Z overlay) are drawn by the drawing layer; the
// `labels` + `normalized` settings only carry the user's choices:
//   - MediaPipe landmarks are already normalized to 0..1 of the frame size.
//   - `normalized: true`  → show those 0..1 values.
//   - `normalized: false` → show raw pixel positions (value × frame width/height).

import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type PoseProcessingSettings = {
	confidenceThreshold: { enabled: boolean; value: number };
	oneEuro: { enabled: boolean; minCutoff: number; beta: number; dCutoff: number };
	kalman: { enabled: boolean; processNoise: number; measurementNoise: number };
	// Which per-landmark coordinate axes to overlay as text on the video/image.
	labels: { showX: boolean; showY: boolean; showZ: boolean };
	// true → coordinates shown as MediaPipe's normalized 0..1; false → raw pixels.
	normalized: boolean;
};

export const DEFAULT_PROCESSING_SETTINGS: PoseProcessingSettings = {
	confidenceThreshold: { enabled: false, value: 0.5 },
	oneEuro: { enabled: false, minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 },
	kalman: { enabled: false, processNoise: 0.01, measurementNoise: 0.1 },
	labels: { showX: false, showY: false, showZ: false },
	normalized: true,
};

// MediaPipe Pose landmark indices used to build the canonical body frame.
const LM = {
	nose: 0,
	leftShoulder: 11,
	rightShoulder: 12,
	leftHip: 23,
	rightHip: 24,
} as const;

export type Vec3 = { x: number; y: number; z: number };

// --- One Euro filter (per scalar) ------------------------------------------

type OneEuroState = { xPrev: number; dxPrev: number; tPrev: number; init: boolean };

const smoothingAlpha = (dt: number, cutoff: number): number => {
	const tau = 1 / (2 * Math.PI * cutoff);
	return 1 / (1 + tau / dt);
};

const oneEuro = (
	state: OneEuroState,
	x: number,
	t: number,
	params: { minCutoff: number; beta: number; dCutoff: number }
): number => {
	if (!state.init || t <= state.tPrev) {
		state.init = true;
		state.xPrev = x;
		state.dxPrev = 0;
		state.tPrev = t;
		return x;
	}

	const dt = t - state.tPrev;
	const dx = (x - state.xPrev) / dt;
	const aD = smoothingAlpha(dt, params.dCutoff);
	const dxHat = aD * dx + (1 - aD) * state.dxPrev;

	const cutoff = params.minCutoff + params.beta * Math.abs(dxHat);
	const a = smoothingAlpha(dt, cutoff);
	const xHat = a * x + (1 - a) * state.xPrev;

	state.xPrev = xHat;
	state.dxPrev = dxHat;
	state.tPrev = t;
	return xHat;
};

// --- Kalman filter (1D random walk, per scalar) ----------------------------

type KalmanState = { x: number; p: number; init: boolean };

const kalman = (
	state: KalmanState,
	z: number,
	params: { processNoise: number; measurementNoise: number }
): number => {
	if (!state.init) {
		state.init = true;
		state.x = z;
		state.p = 1;
		return z;
	}

	// Predict
	state.p += params.processNoise;
	// Update
	const k = state.p / (state.p + params.measurementNoise);
	state.x = state.x + k * (z - state.x);
	state.p = (1 - k) * state.p;
	return state.x;
};

// --- Per-landmark filter state ---------------------------------------------

type LandmarkFilterState = {
	oneEuro: [OneEuroState, OneEuroState, OneEuroState];
	kalman: [KalmanState, KalmanState, KalmanState];
	// Last accepted (filtered) output, used to "coast" through rejected low-confidence frames.
	lastOut: Vec3 | null;
};

const createOneEuroState = (): OneEuroState => ({ xPrev: 0, dxPrev: 0, tPrev: 0, init: false });
const createKalmanState = (): KalmanState => ({ x: 0, p: 1, init: false });

const createLandmarkFilterState = (): LandmarkFilterState => ({
	oneEuro: [createOneEuroState(), createOneEuroState(), createOneEuroState()],
	kalman: [createKalmanState(), createKalmanState(), createKalmanState()],
	lastOut: null,
});

const midpoint = (a: NormalizedLandmark, b: NormalizedLandmark): Vec3 => ({
	x: (a.x + b.x) / 2,
	y: (a.y + b.y) / 2,
	z: (a.z + b.z) / 2,
});

// --- small vector helpers (Vec3) -------------------------------------------
const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vScale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const vCross = (a: Vec3, b: Vec3): Vec3 => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x,
});
const vNorm = (a: Vec3): Vec3 => {
	const m = Math.hypot(a.x, a.y, a.z) || 1e-6;
	return { x: a.x / m, y: a.y / m, z: a.z / m };
};

// Rotate a pose into a canonical, camera-facing orientation using its own body
// frame (built from shoulders and hips). The result is hip-centered with:
//   x = viewer's right, y = down (screen convention), z = depth (front nearest)
// so the patient always faces the camera regardless of the real camera angle —
// giving a consistent frame for downstream role/posture checks.
export const canonicalizePose = (pose: NormalizedLandmark[]): Vec3[] | null => {
	const ls = pose[LM.leftShoulder];
	const rs = pose[LM.rightShoulder];
	const lh = pose[LM.leftHip];
	const rh = pose[LM.rightHip];
	if (!ls || !rs || !lh || !rh) return null;

	const hip = midpoint(lh, rh);
	const shoulder = midpoint(ls, rs);

	// Body-up: hips → shoulders (world y is down, so this points up the torso).
	const up = vNorm(vSub(shoulder, hip));
	// Body-lateral: left → right side, averaged over shoulders and hips.
	let lateral = vAdd(vSub(rs, ls), vSub(rh, lh));
	// Make lateral orthogonal to up, then complete a right-handed frame.
	lateral = vNorm(vSub(lateral, vScale(up, vDot(lateral, up))));
	let forward = vNorm(vCross(lateral, up));

	// Orient "forward" toward the front of the body (where the face is).
	const nose = pose[LM.nose];
	if (nose && vDot(forward, vSub(nose, hip)) < 0) {
		forward = vScale(forward, -1);
	}

	// Project each landmark onto the body frame. Mirror x (a person facing you
	// shows their right on your left) and flip y so up appears up on screen;
	// negate depth so the front of the body is nearest the viewer.
	return pose.map((p) => {
		const rel = vSub(p, hip);
		return {
			x: -vDot(rel, lateral),
			y: -vDot(rel, up),
			z: -vDot(rel, forward),
		};
	});
};

export class PoseProcessor {
	// [poseIndex][landmarkIndex]
	// Per-index filter state, for smoothing every detected pose (no focus point).
	private states: LandmarkFilterState[][] = [];
	// A single dedicated track, used when a focus point locks onto one individual.
	// Keeping it separate means the tracked person's smoothing never blends with
	// another body even when the detector swaps pose indices between frames.
	private focusedStates: LandmarkFilterState[] = [];

	reset(): void {
		this.states = [];
		this.focusedStates = [];
	}

	// Clear only the locked-on track (e.g. when the focus point is moved to a new person).
	resetFocused(): void {
		this.focusedStates = [];
	}

	private ensureState(poseIndex: number, landmarkIndex: number): LandmarkFilterState {
		const poseStates = (this.states[poseIndex] ??= []);
		return (poseStates[landmarkIndex] ??= createLandmarkFilterState());
	}

	// Preprocess one landmark in the recommended order:
	//   1. Confidence gate — reject a below-threshold (unreliable) measurement so it
	//      never corrupts the smoothers; coast on the last accepted estimate instead.
	//   2. One Euro filter — adaptive de-jitter on the accepted measurement.
	//   3. Kalman filter   — model-based smoothing, stacked after One Euro.
	// Normalization / canonicalization happen later (they are output representations),
	// so smoothing always runs in MediaPipe's native 0..1 space.
	private applyFilters(
		state: LandmarkFilterState,
		lm: NormalizedLandmark,
		settings: PoseProcessingSettings,
		timeSeconds: number
	): NormalizedLandmark {
		// 1. Confidence gate (measurement rejection).
		if (settings.confidenceThreshold.enabled && lm.visibility < settings.confidenceThreshold.value) {
			// Don't advance the filters on a bad measurement. Hold the last good
			// estimate if we have one; otherwise pass the raw point through unchanged.
			if (state.lastOut !== null) {
				return { ...lm, x: state.lastOut.x, y: state.lastOut.y, z: state.lastOut.z };
			}
			return { ...lm };
		}

		let { x, y, z } = lm;

		// 2. One Euro filter.
		if (settings.oneEuro.enabled) {
			x = oneEuro(state.oneEuro[0], x, timeSeconds, settings.oneEuro);
			y = oneEuro(state.oneEuro[1], y, timeSeconds, settings.oneEuro);
			z = oneEuro(state.oneEuro[2], z, timeSeconds, settings.oneEuro);
		} else {
			state.oneEuro[0].init = state.oneEuro[1].init = state.oneEuro[2].init = false;
		}

		// 3. Kalman filter.
		if (settings.kalman.enabled) {
			x = kalman(state.kalman[0], x, settings.kalman);
			y = kalman(state.kalman[1], y, settings.kalman);
			z = kalman(state.kalman[2], z, settings.kalman);
		} else {
			state.kalman[0].init = state.kalman[1].init = state.kalman[2].init = false;
		}

		state.lastOut = { x, y, z };
		return { ...lm, x, y, z };
	}

	// Smooth every detected pose by its index. Used when no focus point is set.
	process(
		landmarks: NormalizedLandmark[][],
		settings: PoseProcessingSettings,
		timeSeconds: number
	): NormalizedLandmark[][] {
		return landmarks.map((pose, poseIndex) =>
			pose.map((lm, landmarkIndex) =>
				this.applyFilters(this.ensureState(poseIndex, landmarkIndex), lm, settings, timeSeconds)
			)
		);
	}

	// Smooth a single locked-on pose against the dedicated track, so its data stays
	// consistent for that one individual regardless of detector pose ordering.
	processSingle(pose: NormalizedLandmark[], settings: PoseProcessingSettings, timeSeconds: number): NormalizedLandmark[] {
		return pose.map((lm, landmarkIndex) =>
			this.applyFilters((this.focusedStates[landmarkIndex] ??= createLandmarkFilterState()), lm, settings, timeSeconds)
		);
	}
}
