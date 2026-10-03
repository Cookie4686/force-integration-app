"use client";

import type { Landmark, NormalizedLandmark, PoseLandmarkerOptions } from "@mediapipe/tasks-vision";

import * as Comlink from "comlink";
import { useEffect, useRef, useState } from "react";

// Type-only import: the worker module itself runs in the worker, never in the page.
import type { PoseLandmarkerWorker } from "@/lib/mediapipe/workers/pose.worker";

import { POSE } from "@/lib/pose/landmarks";

// Bundled from src/lib/mediapipe/workers/pose.worker.ts by copy-wasm.mjs.
const WORKER_FILE_PATH = "/workers/pose.worker.js";

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
					const bitmap = await createImageBitmap(video);
					const response = await api.detectForVideo(Comlink.transfer(bitmap, [bitmap]), performance.now());
					if (cancelled) return;
					if (response !== null) {
						const patient = pickPatient(response.result.landmarks);
						frameRef.current = {
							landmarks: response.result.landmarks[patient] ?? null,
							worldLandmarks: response.result.worldLandmarks[patient] ?? null,
							width: video.videoWidth,
							height: video.videoHeight,
							time: performance.now(),
						};
						setHasPerson(patient >= 0);
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
