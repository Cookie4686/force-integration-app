"use client";

import {
	DrawingUtils,
	NormalizedLandmark,
	PoseLandmarker,
	PoseLandmarkerOptions,
	PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import * as Comlink from "comlink";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { PoseLandmarkerWorker } from "@/lib/mediapipe/workers/pose.worker";

export type FocusPoint = { x: number; y: number };

export type ModelStatus = {
	state: "idle" | "load" | "inference" | "error";
	loadTime?: number;
	inferenceTime?: number;
};

export type ModelType = "lite" | "full" | "heavy";

export type ModelOption = Omit<PoseLandmarkerOptions, "baseOptions"> & {
	type: ModelType;
	delegate: "CPU" | "GPU";
};

const WORKER_FILE_PATH = "/workers/pose.worker.js";

const parseOptions = ({ type, delegate, ...options }: ModelOption): PoseLandmarkerOptions => {
	const modelAssetPath =
		type === "lite" ? "/pose/model/pose_landmarker_lite.task"
		: type === "full" ? "/pose/model/pose_landmarker_full.task"
		: "/pose/model/pose_landmarker_heavy.task";

	return {
		baseOptions: {
			delegate,
			modelAssetPath,
		},
		...options,
	};
};

export default function useMediapipePose(initOptions: ModelOption) {
	const lastResultRef = useRef<PoseLandmarkerResult>(null);

	// IMAGE, CANVAS, SKELETAL DISPLAY RELATED FUNCTION
	const imageRef = useRef<HTMLImageElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const focusPointRef = useRef<FocusPoint | null>(null);
	const focusPointRadiusRef = useRef<number>(128);
	const [focusPointRadius, setFocusPointRadius] = useState<number>(128);
	const [maxFocusPointRadius, setMaxFocusPointRadius] = useState<number>(128);

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
					const distance = Math.sqrt(
						(landmark[0].x * canvasRef.current.clientWidth - focusPointRef.current.x) ** 2
							+ (landmark[0].y * canvasRef.current.clientHeight - focusPointRef.current.y) ** 2
					);
					if (distance <= focusPointRadiusRef.current && (minDistance === null || distance < minDistance)) {
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

	const [modelStatus, dispatchModelStatus] = useReducer(modelStatusReducer, { state: "load" });
	const poseWorkerRef = useRef<Comlink.Remote<PoseLandmarkerWorker>>(null);
	const isModelReadyRef = useRef<boolean>(false);

	const detectImageAndDisplayResult = useCallback(async () => {
		if (
			poseWorkerRef.current === null
			|| !isModelReadyRef.current
			|| imageRef.current === null
			|| !imageRef.current.complete
			|| canvasRef.current === null
		)
			return;

		dispatchModelStatus({ state: "inferencing" });
		const response = await poseWorkerRef.current.detect(await window.createImageBitmap(imageRef.current));

		if (response === null) {
			dispatchModelStatus({ state: "error" });
		} else {
			dispatchModelStatus({ state: "inference_finished", inferenceTime: response.inferenceTime });
			lastResultRef.current = response.result;
			displayImageResult(response.result);
		}
	}, []);

	const redrawResult = async (forceRerender: boolean = false) => {
		if (forceRerender || lastResultRef.current === null) {
			await detectImageAndDisplayResult();
		} else {
			displayImageResult(lastResultRef.current);
		}
	};

	// Load Model
	useEffect(() => {
		const loadModel = async () => {
			if (poseWorkerRef.current !== null) return;

			poseWorkerRef.current = Comlink.wrap<PoseLandmarkerWorker>(new Worker(WORKER_FILE_PATH));

			dispatchModelStatus({ state: "loading" });

			const response = await poseWorkerRef.current.initialize(parseOptions(initOptions));

			// TODO: add error checking and handling
			if (response === null) {
				dispatchModelStatus({ state: "error" });
			} else {
				isModelReadyRef.current = true;
				dispatchModelStatus({ state: "load_finished", loadTime: response.loadingTime });
				await detectImageAndDisplayResult();
			}
		};
		loadModel();
		// load model only once the page renders
		// TODO: can we change to on mount or something because I hate use effect
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Update Model Options
	const updateOptions = useCallback(
		async (options: ModelOption): Promise<void> => {
			if (poseWorkerRef.current === null) return;

			isModelReadyRef.current = false;
			dispatchModelStatus({ state: "configuring" });

			const response = await poseWorkerRef.current.setOptions(parseOptions(options));
			if (response === null) {
				// TODO: add error checking and handling
				dispatchModelStatus({ state: "error" });
			} else {
				isModelReadyRef.current = true;
				dispatchModelStatus({ state: "configure_finished", configureTime: response.loadingTime });
				await detectImageAndDisplayResult();
			}
		},
		[detectImageAndDisplayResult]
	);

	// --- FOCUS POINT RELATED FUNCTION ---
	const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);

	const updateFocusPoint = async (focusPoint: typeof focusPointRef.current) => {
		focusPointRef.current = focusPoint;
		setFocusPoint(focusPoint);
	};

	const handleCanvasClick: React.MouseEventHandler<HTMLCanvasElement> = async (event) => {
		if (canvasRef.current === null || imageRef.current === null) return;

		const canvas = canvasRef.current;

		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		await updateFocusPoint({ x, y });
		await redrawResult(false);
	};

	const updateFocusPointRadius = async (radius: number) => {
		focusPointRadiusRef.current = radius;
		setFocusPointRadius(radius);
		await redrawResult(false);
	};

	const handleClearFocusPoint = async () => {
		await updateFocusPoint(null);
		await redrawResult(false);
	};

	const handleOnImageLoad: React.ReactEventHandler<HTMLImageElement> = async (event) => {
		const maxFocusPointRadius = Math.min(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight) / 2;

		setMaxFocusPointRadius(maxFocusPointRadius);
		if (maxFocusPointRadius < focusPointRadiusRef.current) {
			focusPointRadiusRef.current = maxFocusPointRadius;
		}

		await updateFocusPoint(null);
		await redrawResult(true);
	};

	return {
		refs: { imageRef, canvasRef },
		states: { focusPoint, focusPointRadius, maxFocusPointRadius, modelStatus },
		actions: { updateOptions, updateFocusPointRadius },
		handlers: { handleCanvasClick, handleClearFocusPoint, handleOnImageLoad },
	};
}

type ModelStatusAction =
	| { state: "inferencing" }
	| { state: "inference_finished"; inferenceTime: number }
	| { state: "loading" }
	| { state: "load_finished"; loadTime: number }
	| { state: "configuring" }
	| { state: "configure_finished"; configureTime: number }
	| { state: "error"; message?: string };

const modelStatusReducer: React.Reducer<ModelStatus, ModelStatusAction> = (state, action) => {
	switch (action.state) {
		case "loading":
			return { state: "load" };
		case "load_finished":
			return { ...state, state: "idle", loadTime: action.loadTime };
		case "configuring":
			return { ...state, state: "load" };
		case "configure_finished":
			return { ...state, state: "idle", loadTime: action.configureTime };
		case "inferencing":
			return { ...state, state: "inference" };
		case "inference_finished":
			return { ...state, state: "idle", inferenceTime: action.inferenceTime };
		case "error":
			return { ...state, state: "error" };
	}
};
