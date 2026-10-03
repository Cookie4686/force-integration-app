// Detects ArUco markers (the sticker on the force device) in camera frames.
// Runs in a Web Worker; bundled to public/workers/marker.worker.js by copy-wasm.mjs.

import * as Comlink from "comlink";
import { AR } from "js-aruco2";

import { DetectedMarker, MARKER_DICTIONARY, MARKER_MAX_HAMMING, toDetectedMarkers } from "../geometry";

export interface MarkerDetectorWorker {
	detect(imageBitmap: ImageBitmap): { markers: DetectedMarker[]; detectMs: number } | null;
	// Printable marker image (SVG text) for an id, or null for an invalid id.
	getMarkerSvg(id: number): string | null;
}

// Frames are analysed at full resolution up to this width (≈11 ms at 1280 px,
// ≈23 ms at 1920 px). Small markers need every pixel: a 5 cm marker is only
// ~25–40 px wide at 1.5–2.5 m, so downscaling would lose it.
const MAX_WIDTH = 1920;

const dictionary = new AR.Dictionary(MARKER_DICTIONARY);
const detector = new AR.Detector({ dictionaryName: MARKER_DICTIONARY, maxHammingDistance: MARKER_MAX_HAMMING });
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

const api: MarkerDetectorWorker = {
	detect(imageBitmap) {
		try {
			const scale = Math.min(1, MAX_WIDTH / imageBitmap.width);
			const w = Math.round(imageBitmap.width * scale);
			const h = Math.round(imageBitmap.height * scale);
			if (canvas === null || canvas.width !== w || canvas.height !== h) {
				canvas = new OffscreenCanvas(w, h);
				ctx = canvas.getContext("2d", { willReadFrequently: true });
			}
			if (ctx === null) return null;

			ctx.drawImage(imageBitmap, 0, 0, w, h);
			const image = ctx.getImageData(0, 0, w, h);
			const start = performance.now();
			const found = detector.detect(image);
			return { markers: toDetectedMarkers(found, w, h, scale), detectMs: performance.now() - start };
		} catch {
			return null;
		} finally {
			imageBitmap.close();
		}
	},

	getMarkerSvg(id) {
		try {
			return dictionary.generateSVG(id);
		} catch {
			return null;
		}
	},
};

Comlink.expose(api);
