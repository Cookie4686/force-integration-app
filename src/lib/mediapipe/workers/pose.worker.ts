// This will be compiled to js and run in the browser

import { FilesetResolver, PoseLandmarker, PoseLandmarkerOptions, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import * as Comlink from "comlink";

export interface PoseLandmarkerWorker {
	initialize(options: PoseLandmarkerOptions): Promise<void>;
	detect(imageBitmap: ImageBitmap): {
		inferenceTime: number;
		result: PoseLandmarkerResult;
	} | null;
}

let poseLandmarker: PoseLandmarker | null = null;
let isInitializing: boolean = false;

const api: PoseLandmarkerWorker = {
	async initialize(options) {
		if (poseLandmarker === null) {
			isInitializing = true;
			const vision = await FilesetResolver.forVisionTasks(
				// path/to/wasm/root
				"/wasm"
			);
			poseLandmarker = await PoseLandmarker.createFromOptions(vision, options);
		}
	},

	detect(imageBitmap) {
		const startTimeMs = performance.now();

		if (!poseLandmarker) {
			if (isInitializing == false) console.error("Initialize the worker before using worker methods");
			return null;
		}

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
