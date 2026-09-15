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

		const startTimeMs = performance.now();
		const result = poseLandmarker.detect(imageBitmap);
		const inferenceTime = performance.now() - startTimeMs;

		imageBitmap.close();

		return {
			inferenceTime,
			result,
		};
	},
};

// Run Worker
Comlink.expose(api);
