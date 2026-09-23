// This will be compiled to js and run in the browser

import { FilesetResolver, PoseLandmarker, PoseLandmarkerOptions, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import * as Comlink from "comlink";

export interface PoseLandmarkerWorker {
	initialize(options: PoseLandmarkerOptions): Promise<{ loadingTime: number } | null>;
	setOptions(options: PoseLandmarkerOptions): Promise<{ loadingTime: number } | null>;
	detect(imageBitmap: ImageBitmap): {
		inferenceTime: number;
		result: PoseLandmarkerResult;
	} | null;
	detectForVideo(
		imageBitmap: ImageBitmap,
		timestampMs: number
	): {
		inferenceTime: number;
		result: PoseLandmarkerResult;
	} | null;
}

let poseLandmarker: PoseLandmarker | null = null;
let isInitializing: boolean = false;

const api: PoseLandmarkerWorker = {
	async initialize(options) {
		if (poseLandmarker !== null) return null;

		isInitializing = true;

		const startTimeMs = performance.now();
		const vision = await FilesetResolver.forVisionTasks(
			// path/to/wasm/root
			"/wasm"
		);
		poseLandmarker = await PoseLandmarker.createFromOptions(vision, options);
		const inferenceTime = performance.now() - startTimeMs;

		isInitializing = false;

		return { loadingTime: inferenceTime };
	},

	async setOptions(options) {
		if (isInitializing || !poseLandmarker) {
			return null;
		}

		isInitializing = true;

		const startTimeMs = performance.now();
		await poseLandmarker.setOptions(options);
		const inferenceTime = performance.now() - startTimeMs;

		isInitializing = false;

		return { loadingTime: inferenceTime };
	},

	detect(imageBitmap) {
		if (isInitializing || !poseLandmarker) {
			return null;
		}

		try {
			const startTimeMs = performance.now();
			const result = poseLandmarker.detect(imageBitmap);
			const inferenceTime = performance.now() - startTimeMs;

			return {
				inferenceTime,
				result,
			};
		} catch {
			// e.g. called while the model is still in VIDEO running mode
			return null;
		} finally {
			imageBitmap.close();
		}
	},

	detectForVideo(imageBitmap, timestampMs) {
		if (isInitializing || !poseLandmarker) {
			return null;
		}

		try {
			const startTimeMs = performance.now();
			const result = poseLandmarker.detectForVideo(imageBitmap, timestampMs);
			const inferenceTime = performance.now() - startTimeMs;

			return {
				inferenceTime,
				result,
			};
		} catch {
			// e.g. called while the model is still in IMAGE running mode
			return null;
		} finally {
			imageBitmap.close();
		}
	},
};

// Run Worker
Comlink.expose(api);
