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

export type FocusPoint = { x: number; y: number };

export type ModelStatus = {
	state: "idle" | "load" | "inference" | "error";
	loadTime?: number;
	inferenceTime?: number;
};

const WORKER_FILE_PATH = "/workers/pose.worker.js";

export default function useMediapipePose(initOptions: PoseLandmarkerOptions) {
	const lastResultRef = useRef<PoseLandmarkerResult>(null);

	// IMAGE, CANVAS, SKELETAL DISPLAY RELATED FUNCTION
	const imageRef = useRef<HTMLImageElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const focusPointRef = useRef<FocusPoint | null>(null);

	const displayImageResult = (result: PoseLandmarkerResult): void => {
		if (canvasRef.current === null || imageRef.current === null) return;

		const ctx = canvasRef.current.getContext("2d");
		if (!ctx) return;

		canvasRef.current.width = imageRef.current.naturalWidth;
		canvasRef.current.height = imageRef.current.naturalHeight;

		ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
		ctx.beginPath();
		ctx.rect(0, 0, canvasRef.current.width, canvasRef.current.height);
		ctx.clip();

		if (result.landmarks) {
			const drawingUtils = new DrawingUtils(ctx);

			let targetLandmark: NormalizedLandmark[][] = [];

			if (!focusPointRef.current) {
				targetLandmark = result.landmarks;
			} else {
				// Filter According to focus point
				let minDistance: number | null = null;

				for (const landmark of result.landmarks) {
					const distance =
						(landmark[0].x - focusPointRef.current.x / canvasRef.current.clientWidth) ** 2
						+ (landmark[0].y - focusPointRef.current.y / canvasRef.current.clientHeight) ** 2;
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

			drawingUtils.close();
		}
	};

	// --- MODEL RELATED FUNCTION ---

	const [modelStatus, setModelStatus] = useState<ModelStatus>({ state: "load" });
	const poseWorkerRef = useRef<Comlink.Remote<PoseLandmarkerWorker>>(null);
	const isModelReadyRef = useRef<boolean>(false);

	const detectImageAndDisplayResult = async () => {
		if (
			poseWorkerRef.current === null
			|| !isModelReadyRef.current
			|| imageRef.current === null
			|| !imageRef.current.complete
			|| canvasRef.current === null
		)
			return;

		setModelStatus((prev) => ({ ...prev, state: "inference" }));
		const response = await poseWorkerRef.current.detect(await window.createImageBitmap(imageRef.current));
		setModelStatus((prev) => ({ ...prev, state: "idle", inferenceTime: response?.inferenceTime }));

		if (response !== null) {
			lastResultRef.current = response.result;
			displayImageResult(response.result);
		}
	};

	// Load Model
	useEffect(() => {
		const loadModel = async () => {
			if (poseWorkerRef.current !== null) return;

			poseWorkerRef.current = Comlink.wrap<PoseLandmarkerWorker>(new Worker(WORKER_FILE_PATH));
			const response = await poseWorkerRef.current.initialize(initOptions);

			// TODO: add error checking and handling
			if (response === null) {
				setModelStatus((prev) => ({ ...prev, state: "error" }));
			} else {
				isModelReadyRef.current = true;
				setModelStatus((prev) => ({ ...prev, state: "idle", loadTime: response.loadingTime }));
				await detectImageAndDisplayResult();
			}
		};
		loadModel();
		// load model only once the page renders
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Update Model Options
	// TODO: add model enum type to this function or something and point to the model public path
	const updateOptions = async (options: PoseLandmarkerOptions): Promise<void> => {
		if (poseWorkerRef.current === null) return;

		isModelReadyRef.current = false;
		setModelStatus((prev) => ({ ...prev, state: "load" }));
		const response = await poseWorkerRef.current.setOptions(options);
		if (response === null) {
			// TODO: add error checking and handling
			setModelStatus((prev) => ({ ...prev, state: "error" }));
		} else {
			isModelReadyRef.current = true;
			setModelStatus((prev) => ({ ...prev, state: "idle", loadTime: response.loadingTime }));
			await detectImageAndDisplayResult();
		}
	};

	// --- FOCUS POINT RELATED FUNCTION ---
	const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);

	const updateFocusPoint = async (focusPoint: typeof focusPointRef.current, forceRerender: boolean = false) => {
		focusPointRef.current = focusPoint;
		setFocusPoint(focusPoint);

		if (forceRerender || lastResultRef.current === null) {
			await detectImageAndDisplayResult();
		} else {
			displayImageResult(lastResultRef.current);
		}
	};

	const handleCanvasClick: React.MouseEventHandler<HTMLCanvasElement> = async (event) => {
		if (canvasRef.current === null || imageRef.current === null) return;

		const canvas = canvasRef.current;

		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		await updateFocusPoint({ x, y }, false);
	};

	const handleClearFocusPoint = async () => {
		await updateFocusPoint(null, false);
	};

	const handleOnImageLoad = async () => {
		await updateFocusPoint(null, true);
	};

	return {
		refs: { imageRef, canvasRef },
		states: { focusPoint, modelStatus },
		actions: { updateOptions },
		handlers: { handleCanvasClick, handleClearFocusPoint, handleOnImageLoad },
	};
}
