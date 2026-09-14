"use client";

import {
	DrawingUtils,
	NormalizedLandmark,
	PoseLandmarker,
	PoseLandmarkerOptions,
	PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import * as Comlink from "comlink";
import { useEffect, useRef, useState } from "react";

import { PoseLandmarkerWorker } from "@/lib/mediapipe/workers/pose.worker";

const WORKER_FILE_PATH = "/workers/pose.worker.js";

export type FocusPoint = { x: number; y: number };

export default function useMediapipePose(options: PoseLandmarkerOptions) {
	const [drawingUtils, setDrawingUtils] = useState<DrawingUtils | null>(null);

	// IMAGE, CANVAS for skeletal display
	const imageRef = useRef<HTMLImageElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	const image = imageRef.current;
	const canvas = canvasRef.current;

	const displayImageResult = (result: PoseLandmarkerResult, focusPoint?: FocusPoint | null) => {
		if (canvas === null || image === null) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.beginPath();
		ctx.rect(0, 0, canvas.width, canvas.height);
		ctx.clip();

		if (result.landmarks) {
			if (drawingUtils === null) setDrawingUtils(new DrawingUtils(ctx));
			if (drawingUtils === null) return;

			let targetLandmark: NormalizedLandmark[][] = [];

			if (!focusPoint) {
				targetLandmark = result.landmarks;
			} else {
				// Filter According to focus point
				let minDistance: number | null = null;

				for (const landmark of result.landmarks) {
					const distance =
						(landmark[0].x - focusPoint.x / canvas.clientWidth) ** 2
						+ (landmark[0].y - focusPoint.y / canvas.clientHeight) ** 2;
					if (minDistance === null || distance < minDistance) {
						minDistance = distance;
						targetLandmark = [landmark];
					}
				}
			}

			for (const landmark of targetLandmark) {
				drawingUtils.drawLandmarks(landmark, {
					radius: (data) => DrawingUtils.lerp(data.from!.z, -0.15, 0.1, 5, 1),
				});
				drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS);
			}
		}
	};

	const drawSkeletal = async (focusPoint: FocusPoint | null) => {
		if (!poseLandmarker || !image || !image.complete || !canvas) return;

		const response = await poseLandmarker.detect(await window.createImageBitmap(image));
		if (response !== null) {
			displayImageResult(response.result, focusPoint);
		}
	};

	// LOAD MODEL
	const [poseLandmarker, setPoseLandmarker] = useState<Comlink.Remote<PoseLandmarkerWorker> | null>(null);

	useEffect(() => {
		const loadModel = async () => {
			const poseLandmarkerWorker = Comlink.wrap<PoseLandmarkerWorker>(new Worker(WORKER_FILE_PATH));

			await poseLandmarkerWorker.initialize(options);

			setPoseLandmarker(() => poseLandmarkerWorker);
		};
		loadModel();
		// load model only once the page renders
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { imageRef, canvasRef, drawSkeletal };
}
