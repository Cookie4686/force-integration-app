"use client";

import type { Landmark, NormalizedLandmark, PoseLandmarkerOptions } from "@mediapipe/tasks-vision";

import * as Comlink from "comlink";
import { useEffect, useRef, useState } from "react";

// Type-only import: the worker module itself runs in the worker, never in the page.
import type { PoseLandmarkerWorker } from "@/lib/mediapipe/workers/pose.worker";

import { POSE } from "@/lib/pose/landmarks";
import { DEFAULT_PROCESSING_SETTINGS, PoseProcessingSettings, PoseProcessor } from "@/lib/pose/processing";

// Bundled from src/lib/mediapipe/workers/pose.worker.ts by copy-wasm.mjs.
const WORKER_FILE_PATH = "/workers/pose.worker.js";

// Smoothing for the test screen: the team's researched pipeline from /tool/pose
// (lib/pose/processing.ts), applied per landmark in this order on MediaPipe's
// normalized 0..1 coordinates (converted to pixels only when angles are computed):
//   1. Confidence threshold — ignore unreliable points instead of letting them pull the filters.
//   2. One Euro — strong smoothing when still (the patient holds a position), little lag when moving fast.
//   3. Kalman — removes the remaining jitter (random-walk model).
// Tune the values live on /tool/pose (Video tab → Signal Processing), then copy them here.
const SMOOTHING: PoseProcessingSettings = {
	...DEFAULT_PROCESSING_SETTINGS,
	confidenceThreshold: { enabled: true, value: 0.5 },
	oneEuro: { enabled: true, minCutoff: 1.0, beta: 5, dCutoff: 1.0 },
	kalman: { enabled: true, processNoise: 0.01, measurementNoise: 0.1 },
};

// If the tracked shoulder midpoint jumps further than this (fraction of the frame)
// between detections, a different person was picked: restart the filters.
const PERSON_SWITCH_DISTANCE = 0.15;

const MODEL_OPTIONS = (delegate: "GPU" | "CPU"): PoseLandmarkerOptions => ({
	baseOptions: { modelAssetPath: "/pose/model/pose_landmarker_lite.task", delegate },
	runningMode: "VIDEO",
	// The doctor may be in frame too; the patient is picked below.
	numPoses: 2,
});

export type PoseStreamStatus = "loading" | "ready" | "error";

export type PoseFrame = {
	// The tracked patient: 33 landmarks, x/y normalized 0..1 of the video frame.
	landmarks: NormalizedLandmark[] | null;
	// Same person in metres, hip-centred (for angle calculation later).
	worldLandmarks: Landmark[] | null;
	// Video frame size the landmarks refer to.
	width: number;
	height: number;
	time: number;
};

// The patient is the person whose shoulder midpoint is closest to the frame centre
// (the setup checklist asks for only the patient near the centre).
const pickPatient = (poses: NormalizedLandmark[][]): number => {
	let best = -1;
	let bestDistance = Infinity;
	poses.forEach((pose, idx) => {
		const left = pose[POSE.leftShoulder];
		const right = pose[POSE.rightShoulder];
		if (!left || !right) return;
		const distance = Math.hypot((left.x + right.x) / 2 - 0.5, (left.y + right.y) / 2 - 0.5);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = idx;
		}
	});
	return best;
};

// Runs MediaPipe pose detection on every new frame of `videoRef` in a Web Worker.
// Results go into `frameRef` (not state), so drawing never re-renders React.
export default function usePoseStream(videoRef: React.RefObject<HTMLVideoElement | null>) {
	const frameRef = useRef<PoseFrame | null>(null);
	const [status, setStatus] = useState<PoseStreamStatus>("loading");
	const [hasPerson, setHasPerson] = useState(false);

	useEffect(() => {
		const worker = new Worker(WORKER_FILE_PATH);
		const api = Comlink.wrap<PoseLandmarkerWorker>(worker);
		let cancelled = false;
		let ready = false;
		let rafId = 0;
		let lastVideoTime = -1;
		// Separate smoothing tracks for the 2D (drawing) and 3D world (angles) landmarks.
		const imageSmoother = new PoseProcessor();
		const worldSmoother = new PoseProcessor();
		let lastShoulderMid: { x: number; y: number } | null = null;

		// GPU first; fall back to CPU if the GPU delegate cannot start.
		api
			.initialize(MODEL_OPTIONS("GPU"))
			.catch(() => api.initialize(MODEL_OPTIONS("CPU")))
			.then((response) => {
				if (cancelled) return;
				ready = response !== null;
				setStatus(ready ? "ready" : "error");
			})
			.catch(() => {
				if (!cancelled) setStatus("error");
			});

		const loop = async () => {
			const video = videoRef.current;
			if (
				ready
				&& video !== null
				&& video.readyState >= 2 // HAVE_CURRENT_DATA
				&& video.videoWidth > 0
				&& video.currentTime !== lastVideoTime
			) {
				lastVideoTime = video.currentTime;
				try {
					const now = performance.now();
					const bitmap = await createImageBitmap(video);
					const response = await api.detectForVideo(Comlink.transfer(bitmap, [bitmap]), now);
					if (cancelled) return;
					if (response !== null) {
						const patient = pickPatient(response.result.landmarks);
						const raw = response.result.landmarks[patient];
						const rawWorld = response.result.worldLandmarks[patient];

						let landmarks: NormalizedLandmark[] | null = null;
						let worldLandmarks: Landmark[] | null = null;
						if (raw) {
							// A big jump means a different person was picked — don't blend two bodies.
							const mid = {
								x: (raw[POSE.leftShoulder].x + raw[POSE.rightShoulder].x) / 2,
								y: (raw[POSE.leftShoulder].y + raw[POSE.rightShoulder].y) / 2,
							};
							if (
								lastShoulderMid
								&& Math.hypot(mid.x - lastShoulderMid.x, mid.y - lastShoulderMid.y) > PERSON_SWITCH_DISTANCE
							) {
								imageSmoother.resetFocused();
								worldSmoother.resetFocused();
							}
							lastShoulderMid = mid;

							landmarks = imageSmoother.processSingle(raw, SMOOTHING, now / 1000);
							worldLandmarks = rawWorld ? worldSmoother.processSingle(rawWorld, SMOOTHING, now / 1000) : null;
						}

						frameRef.current = {
							landmarks,
							worldLandmarks,
							width: video.videoWidth,
							height: video.videoHeight,
							time: now,
						};
						setHasPerson(raw !== undefined);
					}
				} catch {
					// transient frame / detection failure — keep the loop alive
				}
			}
			if (!cancelled) rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);

		return () => {
			cancelled = true;
			cancelAnimationFrame(rafId);
			frameRef.current = null;
			api[Comlink.releaseProxy]();
			worker.terminate();
		};
	}, [videoRef]);

	return { frameRef, status, hasPerson };
}
