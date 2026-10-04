"use client";

import * as Comlink from "comlink";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MarkerFrame } from "@/lib/marker/geometry";
// Type-only import: the worker module itself runs in the worker, never in the page.
import type { MarkerDetectorWorker } from "@/lib/marker/workers/marker.worker";

// Bundled from src/lib/marker/workers/marker.worker.ts by copy-wasm.mjs.
const WORKER_FILE_PATH = "/workers/marker.worker.js";

export type MarkerStreamStatus = "ready" | "error";

// Detects ArUco markers on every new frame of `videoRef` in a Web Worker.
// Results go into `frameRef` (not state), so drawing never re-renders React.
// With `enabled` false, no worker is started.
export default function useMarkerStream(videoRef: React.RefObject<HTMLVideoElement | null>, enabled = true) {
	const frameRef = useRef<MarkerFrame | null>(null);
	const [status, setStatus] = useState<MarkerStreamStatus>("ready");
	const apiRef = useRef<Comlink.Remote<MarkerDetectorWorker> | null>(null);

	useEffect(() => {
		if (!enabled) return;
		const worker = new Worker(WORKER_FILE_PATH);
		const api = Comlink.wrap<MarkerDetectorWorker>(worker);
		apiRef.current = api;
		let cancelled = false;
		let rafId = 0;
		let lastVideoTime = -1;
		let failures = 0;
		let count = 0;

		const loop = async () => {
			const video = videoRef.current;
			if (video !== null && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
				lastVideoTime = video.currentTime;
				try {
					const bitmap = await createImageBitmap(video);
					const result = await api.detect(Comlink.transfer(bitmap, [bitmap]));
					if (cancelled) return;
					if (result !== null) {
						failures = 0;
						frameRef.current = {
							markers: result.markers,
							width: video.videoWidth,
							height: video.videoHeight,
							detectMs: result.detectMs,
							time: performance.now(),
							count: ++count,
						};
					}
				} catch {
					// The worker script failed to load or crashed repeatedly.
					if (++failures === 30) setStatus("error");
				}
			}
			if (!cancelled) rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);

		return () => {
			cancelled = true;
			cancelAnimationFrame(rafId);
			frameRef.current = null;
			apiRef.current = null;
			api[Comlink.releaseProxy]();
			worker.terminate();
		};
	}, [videoRef, enabled]);

	// Printable marker SVG, generated in the worker (keeps js-aruco2 out of the page bundle).
	const getMarkerSvg = useCallback(
		async (id: number): Promise<string | null> => (apiRef.current ? apiRef.current.getMarkerSvg(id) : null),
		[]
	);

	return { frameRef, status, getMarkerSvg };
}
