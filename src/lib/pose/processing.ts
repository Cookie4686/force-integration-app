// Signal-processing pipeline for a stream of MediaPipe pose landmarks.
//
// Applied per frame, in the main thread, between detection and drawing:
//   1. One Euro filter (jitter/lag-adaptive smoothing) — optional
//   2. Kalman filter   (random-walk smoothing)          — optional
//   3. Confidence threshold — applied at draw time (see minVisibility)
//   4. Pose-relative normalization — hip-centered, torso-scaled readout
//
// One Euro and Kalman are independent switches and stack in that order when
// both are enabled. Filter state is keyed by (pose index, landmark index,
// coordinate); it is reset via reset() whenever the source or pose count
// changes so state from one clip/person does not leak into another.

import { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type ToggleWithValue = { enabled: boolean; value: number };

export type PoseProcessingSettings = {
	confidenceThreshold: { enabled: boolean; value: number };
	oneEuro: { enabled: boolean; minCutoff: number; beta: number; dCutoff: number };
	kalman: { enabled: boolean; processNoise: number; measurementNoise: number };
	normalization: { enabled: boolean };
};

export const DEFAULT_PROCESSING_SETTINGS: PoseProcessingSettings = {
	confidenceThreshold: { enabled: false, value: 0.5 },
	oneEuro: { enabled: false, minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 },
	kalman: { enabled: false, processNoise: 0.01, measurementNoise: 0.1 },
	normalization: { enabled: false },
};

// MediaPipe Pose landmark indices used for normalization / readout.
const LM = {
	nose: 0,
	leftShoulder: 11,
	rightShoulder: 12,
	leftWrist: 15,
	rightWrist: 16,
	leftHip: 23,
	rightHip: 24,
	leftAnkle: 27,
	rightAnkle: 28,
} as const;

export type Vec3 = { x: number; y: number; z: number };

export type PoseReadout = {
	hipCenter: Vec3;
	torsoScale: number;
	// A few key landmarks in normalized (hip-centered, torso-scaled) space.
	keyPoints: { label: string; x: number; y: number; z: number; visibility: number }[];
};

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
};

const createOneEuroState = (): OneEuroState => ({ xPrev: 0, dxPrev: 0, tPrev: 0, init: false });
const createKalmanState = (): KalmanState => ({ x: 0, p: 1, init: false });

const createLandmarkFilterState = (): LandmarkFilterState => ({
	oneEuro: [createOneEuroState(), createOneEuroState(), createOneEuroState()],
	kalman: [createKalmanState(), createKalmanState(), createKalmanState()],
});

const dist3 = (a: Vec3, b: Vec3): number =>
	Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

const midpoint = (a: NormalizedLandmark, b: NormalizedLandmark): Vec3 => ({
	x: (a.x + b.x) / 2,
	y: (a.y + b.y) / 2,
	z: (a.z + b.z) / 2,
});

export const normalizePose = (pose: NormalizedLandmark[]): PoseReadout | null => {
	const lh = pose[LM.leftHip];
	const rh = pose[LM.rightHip];
	const ls = pose[LM.leftShoulder];
	const rs = pose[LM.rightShoulder];
	if (!lh || !rh || !ls || !rs) return null;

	const hipCenter = midpoint(lh, rh);
	const shoulderCenter = midpoint(ls, rs);
	const torsoScale = dist3(hipCenter, shoulderCenter) || 1e-6;

	const norm = (lm: NormalizedLandmark, label: string) => ({
		label,
		x: (lm.x - hipCenter.x) / torsoScale,
		y: (lm.y - hipCenter.y) / torsoScale,
		z: (lm.z - hipCenter.z) / torsoScale,
		visibility: lm.visibility,
	});

	return {
		hipCenter,
		torsoScale,
		keyPoints: [
			norm(pose[LM.nose], "Nose"),
			norm(pose[LM.leftWrist], "L Wrist"),
			norm(pose[LM.rightWrist], "R Wrist"),
			norm(pose[LM.leftAnkle], "L Ankle"),
			norm(pose[LM.rightAnkle], "R Ankle"),
		],
	};
};

export type ProcessedFrame = {
	landmarks: NormalizedLandmark[][];
	readout: PoseReadout | null;
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

	private applyFilters(
		state: LandmarkFilterState,
		lm: NormalizedLandmark,
		settings: PoseProcessingSettings,
		timeSeconds: number
	): NormalizedLandmark {
		let { x, y, z } = lm;

		if (settings.oneEuro.enabled) {
			x = oneEuro(state.oneEuro[0], x, timeSeconds, settings.oneEuro);
			y = oneEuro(state.oneEuro[1], y, timeSeconds, settings.oneEuro);
			z = oneEuro(state.oneEuro[2], z, timeSeconds, settings.oneEuro);
		} else {
			state.oneEuro[0].init = state.oneEuro[1].init = state.oneEuro[2].init = false;
		}

		if (settings.kalman.enabled) {
			x = kalman(state.kalman[0], x, settings.kalman);
			y = kalman(state.kalman[1], y, settings.kalman);
			z = kalman(state.kalman[2], z, settings.kalman);
		} else {
			state.kalman[0].init = state.kalman[1].init = state.kalman[2].init = false;
		}

		return { ...lm, x, y, z };
	}

	// Smooth every detected pose by its index. Used when no focus point is set.
	process(
		landmarks: NormalizedLandmark[][],
		settings: PoseProcessingSettings,
		timeSeconds: number
	): ProcessedFrame {
		const outLandmarks = landmarks.map((pose, poseIndex) =>
			pose.map((lm, landmarkIndex) =>
				this.applyFilters(this.ensureState(poseIndex, landmarkIndex), lm, settings, timeSeconds)
			)
		);

		const readout =
			settings.normalization.enabled && outLandmarks.length > 0 ? normalizePose(outLandmarks[0]) : null;

		return { landmarks: outLandmarks, readout };
	}

	// Smooth a single locked-on pose against the dedicated track, so its data stays
	// consistent for that one individual regardless of detector pose ordering.
	processSingle(
		pose: NormalizedLandmark[],
		settings: PoseProcessingSettings,
		timeSeconds: number
	): ProcessedFrame {
		const smoothed = pose.map((lm, landmarkIndex) =>
			this.applyFilters((this.focusedStates[landmarkIndex] ??= createLandmarkFilterState()), lm, settings, timeSeconds)
		);

		const readout = settings.normalization.enabled ? normalizePose(smoothed) : null;

		return { landmarks: [smoothed], readout };
	}
}
