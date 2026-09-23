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

	// IMAGE, VIDEO, CANVAS, SKELETAL DISPLAY RELATED FUNCTION
	const imageRef = useRef<HTMLImageElement | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const focusPointRef = useRef<FocusPoint | null>(null);
	const focusPointRadiusRef = useRef<number>(128);
	const [focusPointRadius, setFocusPointRadius] = useState<number>(128);
	const [maxFocusPointRadius, setMaxFocusPointRadius] = useState<number>(128);

	// Draw a detection result onto the overlay canvas. The canvas backing store is
	// sized to the intrinsic dimensions of the source (image or video frame); it is
	// then stretched over the displayed element via CSS.
	const drawResult = (result: PoseLandmarkerResult, sourceWidth: number, sourceHeight: number): void => {
		if (canvasRef.current === null || sourceWidth === 0 || sourceHeight === 0) return;

		const ctx = canvasRef.current.getContext("2d");
		if (!ctx) return;

		canvasRef.current.width = sourceWidth;
		canvasRef.current.height = sourceHeight;

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

	const displayImageResult = (result: PoseLandmarkerResult): void => {
		if (imageRef.current === null) return;
		drawResult(result, imageRef.current.naturalWidth, imageRef.current.naturalHeight);
	};

	const displayVideoResult = (result: PoseLandmarkerResult): void => {
		if (videoRef.current === null) return;
		drawResult(result, videoRef.current.videoWidth, videoRef.current.videoHeight);
	};

	// Redraw the most recent result onto whichever source is currently active.
	// Used by focus-point interactions so the overlay updates even on a paused video.
	const redisplayLastResult = (): void => {
		if (lastResultRef.current === null) return;
		if (videoRef.current !== null && videoRef.current.videoWidth > 0) {
			displayVideoResult(lastResultRef.current);
		} else {
			displayImageResult(lastResultRef.current);
		}
	};

	// --- MODEL RELATED FUNCTION ---

	const [modelStatus, dispatchModelStatus] = useReducer(modelStatusReducer, { state: "load" });
	const poseWorkerRef = useRef<Comlink.Remote<PoseLandmarkerWorker>>(null);
	const isModelReadyRef = useRef<boolean>(false);
	const runningModeRef = useRef<ModelOption["runningMode"]>(initOptions.runningMode);

	const detectImageAndDisplayResult = useCallback(async () => {
		if (
			poseWorkerRef.current === null
			|| !isModelReadyRef.current
			|| runningModeRef.current === "VIDEO"
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
			runningModeRef.current = options.runningMode;
			dispatchModelStatus({ state: "configuring" });

			const response = await poseWorkerRef.current.setOptions(parseOptions(options));
			if (response === null) {
				// TODO: add error checking and handling
				dispatchModelStatus({ state: "error" });
			} else {
				isModelReadyRef.current = true;
				dispatchModelStatus({ state: "configure_finished", configureTime: response.loadingTime });
				// In VIDEO mode the RAF loop drives detection; only re-run the still-image
				// path here so we don't call detect() while the model expects a video frame.
				if (options.runningMode !== "VIDEO") {
					await detectImageAndDisplayResult();
				}
			}
		},
		[detectImageAndDisplayResult]
	);

	// --- VIDEO / WEBCAM RELATED FUNCTION ---
	const [isWebcamActive, setIsWebcamActive] = useState(false);
	const streamRef = useRef<MediaStream | null>(null);
	const rafIdRef = useRef<number | null>(null);
	const lastVideoTimeRef = useRef<number>(-1);

	const stopVideoDetection = useCallback(() => {
		if (rafIdRef.current !== null) {
			cancelAnimationFrame(rafIdRef.current);
			rafIdRef.current = null;
		}
	}, []);

	// Continuously detect poses on the <video> element's current frame. The loop
	// self-heals: it keeps rescheduling until the model is ready and switched to
	// VIDEO running mode, and skips frames that have not advanced (paused video).
	const startVideoDetection = useCallback(() => {
		if (rafIdRef.current !== null) return;
		lastVideoTimeRef.current = -1;

		const loop = async () => {
			const video = videoRef.current;
			const worker = poseWorkerRef.current;

			if (
				video !== null
				&& worker !== null
				&& isModelReadyRef.current
				&& runningModeRef.current === "VIDEO"
				&& canvasRef.current !== null
				&& video.readyState >= 2 // HAVE_CURRENT_DATA
				&& video.currentTime !== lastVideoTimeRef.current
			) {
				lastVideoTimeRef.current = video.currentTime;

				try {
					const bitmap = await window.createImageBitmap(video);
					const response = await worker.detectForVideo(bitmap, performance.now());
					if (response !== null) {
						lastResultRef.current = response.result;
						dispatchModelStatus({ state: "inference_finished", inferenceTime: response.inferenceTime });
						displayVideoResult(response.result);
					}
				} catch {
					// transient decode/detect failures — keep the loop alive
				}
			}

			rafIdRef.current = requestAnimationFrame(loop);
		};

		rafIdRef.current = requestAnimationFrame(loop);
		// loop only reads refs, so a stable identity is safe
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const startCamera = useCallback(async () => {
		if (videoRef.current === null || streamRef.current !== null) return;

		const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
		streamRef.current = stream;
		videoRef.current.srcObject = stream;
		await videoRef.current.play();
		setIsWebcamActive(true);
	}, []);

	const stopCamera = useCallback(() => {
		streamRef.current?.getTracks().forEach((track) => track.stop());
		streamRef.current = null;
		if (videoRef.current !== null) {
			videoRef.current.srcObject = null;
		}
		setIsWebcamActive(false);
	}, []);

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
		redisplayLastResult();
	};

	const updateFocusPointRadius = async (radius: number) => {
		focusPointRadiusRef.current = radius;
		setFocusPointRadius(radius);
		redisplayLastResult();
	};

	const handleClearFocusPoint = async () => {
		await updateFocusPoint(null);
		redisplayLastResult();
	};

	const applyMaxFocusPointRadius = (sourceWidth: number, sourceHeight: number) => {
		const maxRadius = Math.min(sourceWidth, sourceHeight) / 2;
		setMaxFocusPointRadius(maxRadius);
		if (maxRadius < focusPointRadiusRef.current) {
			focusPointRadiusRef.current = maxRadius;
			setFocusPointRadius(maxRadius);
		}
	};

	const handleOnImageLoad: React.ReactEventHandler<HTMLImageElement> = async (event) => {
		applyMaxFocusPointRadius(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);

		await updateFocusPoint(null);
		await redrawResult(true);
	};

	const handleVideoLoadedMetadata: React.ReactEventHandler<HTMLVideoElement> = async (event) => {
		applyMaxFocusPointRadius(event.currentTarget.videoWidth, event.currentTarget.videoHeight);

		await updateFocusPoint(null);
		lastVideoTimeRef.current = -1;
	};

	return {
		refs: { imageRef, videoRef, canvasRef },
		states: { focusPoint, focusPointRadius, maxFocusPointRadius, modelStatus, isWebcamActive },
		actions: { updateOptions, updateFocusPointRadius, startVideoDetection, stopVideoDetection, startCamera, stopCamera },
		handlers: { handleCanvasClick, handleClearFocusPoint, handleOnImageLoad, handleVideoLoadedMetadata },
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
