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
import {
	DEFAULT_PROCESSING_SETTINGS,
	PoseProcessingSettings,
	PoseProcessor,
	PoseReadout,
} from "@/lib/pose/processing";

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
	// Most recently drawn landmark set (already signal-processed) + the confidence
	// threshold it was drawn with, so focus-point interactions can redraw it.
	const lastLandmarksRef = useRef<NormalizedLandmark[][] | null>(null);
	const lastMinVisibilityRef = useRef<number | undefined>(undefined);

	// IMAGE, VIDEO, CANVAS, SKELETAL DISPLAY RELATED FUNCTION
	const imageRef = useRef<HTMLImageElement | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const focusPointRef = useRef<FocusPoint | null>(null);
	const focusPointRadiusRef = useRef<number>(128);
	const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);
	const [focusPointRadius, setFocusPointRadius] = useState<number>(128);
	const [maxFocusPointRadius, setMaxFocusPointRadius] = useState<number>(128);

	// Draw a set of poses onto the overlay canvas. The canvas backing store is
	// sized to the intrinsic dimensions of the source (image or video frame); it is
	// then stretched over the displayed element via CSS. When minVisibility is set,
	// landmarks (and any connection touching them) below that visibility are hidden.
	const drawResult = (
		landmarksSet: NormalizedLandmark[][],
		sourceWidth: number,
		sourceHeight: number,
		minVisibility?: number
	): void => {
		if (canvasRef.current === null || sourceWidth === 0 || sourceHeight === 0) return;

		const ctx = canvasRef.current.getContext("2d");
		if (!ctx) return;

		canvasRef.current.width = sourceWidth;
		canvasRef.current.height = sourceHeight;

		ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
		ctx.beginPath();
		ctx.rect(0, 0, canvasRef.current.width, canvasRef.current.height);
		ctx.clip();

		if (landmarksSet) {
			const drawingUtils = new DrawingUtils(ctx);

			let targetLandmark: NormalizedLandmark[][] = [];

			if (!focusPointRef.current) {
				targetLandmark = landmarksSet;
			} else {
				// Filter According to focus point
				let minDistance: number | null = null;

				for (const landmark of landmarksSet) {
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
				const connections =
					minVisibility === undefined ?
						PoseLandmarker.POSE_CONNECTIONS
					:	PoseLandmarker.POSE_CONNECTIONS.filter(
							({ start, end }) =>
								(landmark[start]?.visibility ?? 1) >= minVisibility
								&& (landmark[end]?.visibility ?? 1) >= minVisibility
						);

				drawingUtils.drawLandmarks(landmark, {
					radius: (data) => {
						if (minVisibility !== undefined && (data.from?.visibility ?? 1) < minVisibility) return 0;
						return DrawingUtils.lerp(data.from!.z, -0.15, 0.1, 5, 1);
					},
				});
				drawingUtils.drawConnectors(landmark, connections);
			}

			drawingUtils.close();
		}
	};

	const displayImageResult = (result: PoseLandmarkerResult): void => {
		if (imageRef.current === null) return;
		lastLandmarksRef.current = result.landmarks;
		lastMinVisibilityRef.current = undefined;
		drawResult(result.landmarks, imageRef.current.naturalWidth, imageRef.current.naturalHeight);
	};

	// Redraw the most recent (processed) landmark set onto whichever source is
	// active. Used by focus-point interactions so the overlay updates even on a
	// paused video.
	const redisplayLastResult = (): void => {
		if (lastLandmarksRef.current === null) return;
		if (videoRef.current !== null && videoRef.current.videoWidth > 0) {
			drawResult(
				lastLandmarksRef.current,
				videoRef.current.videoWidth,
				videoRef.current.videoHeight,
				lastMinVisibilityRef.current
			);
		} else if (imageRef.current !== null) {
			drawResult(
				lastLandmarksRef.current,
				imageRef.current.naturalWidth,
				imageRef.current.naturalHeight,
				lastMinVisibilityRef.current
			);
		}
	};

	// --- MODEL RELATED FUNCTION ---

	const [modelStatus, dispatchModelStatus] = useReducer(modelStatusReducer, { state: "load" });
	const poseWorkerRef = useRef<Comlink.Remote<PoseLandmarkerWorker>>(null);
	const isModelReadyRef = useRef<boolean>(false);
	const runningModeRef = useRef<ModelOption["runningMode"]>(initOptions.runningMode);

	// --- SIGNAL PROCESSING RELATED FUNCTION ---
	const processorRef = useRef<PoseProcessor>(new PoseProcessor());
	const processingSettingsRef = useRef<PoseProcessingSettings>(DEFAULT_PROCESSING_SETTINGS);
	const [poseReadout, setPoseReadout] = useState<PoseReadout | null>(null);
	const lastReadoutTimeRef = useRef<number>(0);

	const updateProcessingSettings = useCallback((settings: PoseProcessingSettings) => {
		processingSettingsRef.current = settings;
	}, []);

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
			displayImageResult(response.result);
		}
	}, []);

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
			// Pose indices may remap after reconfiguring (e.g. numPoses change) — clear
			// smoothing state so filters don't blend across different tracked bodies.
			processorRef.current.reset();
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
					const now = performance.now();
					const bitmap = await window.createImageBitmap(video);
					const response = await worker.detectForVideo(bitmap, now);
					if (response !== null) {
						const settings = processingSettingsRef.current;
						const rawPoses = response.result.landmarks;
						const minVisibility =
							settings.confidenceThreshold.enabled ? settings.confidenceThreshold.value : undefined;
						const canvas = canvasRef.current;
						const cw = canvas.clientWidth;
						const ch = canvas.clientHeight;
						const focus = focusPointRef.current;

						let drawSet: NormalizedLandmark[][];
						let readout: PoseReadout | null = null;

						if (focus !== null) {
							// Static reference: the focus point stays exactly where the user
							// placed it (e.g. on the seated patient). Each frame we pick the
							// person currently nearest that fixed point, so a doctor moving
							// through the scene can never drag the tracked position away —
							// once they step aside, the patient by the reference is selected
							// again.
							let target: NormalizedLandmark[] | null = null;
							let bestDistance: number | null = null;
							if (cw > 0 && ch > 0) {
								for (const pose of rawPoses) {
									const px = pose[0].x * cw;
									const py = pose[0].y * ch;
									const distance = Math.hypot(px - focus.x, py - focus.y);
									if (
										distance <= focusPointRadiusRef.current
										&& (bestDistance === null || distance < bestDistance)
									) {
										bestDistance = distance;
										target = pose;
									}
								}
							}

							if (target !== null) {
								const single = processorRef.current.processSingle(target, settings, now / 1000);
								drawSet = single.landmarks;
								readout = single.readout;
							} else {
								// Nobody within range of the reference — hide the skeleton until
								// someone is near it again. The focus point does not move.
								drawSet = [];
							}
						} else {
							const processed = processorRef.current.process(rawPoses, settings, now / 1000);
							drawSet = processed.landmarks;
							readout = processed.readout;
						}

						lastLandmarksRef.current = drawSet;
						lastMinVisibilityRef.current = minVisibility;

						dispatchModelStatus({ state: "inference_finished", inferenceTime: response.inferenceTime });
						drawResult(drawSet, video.videoWidth, video.videoHeight, minVisibility);

						// Throttle readout state updates so we don't re-render every frame.
						if (now - lastReadoutTimeRef.current > 100) {
							lastReadoutTimeRef.current = now;
							setPoseReadout(readout);
						}
					}
				} catch {
					// transient decode/detect failures — keep the loop alive
				}
			}

			rafIdRef.current = requestAnimationFrame(loop);
		};

		rafIdRef.current = requestAnimationFrame(loop);
		// loop only reads refs, so a stable identity is safe
	}, []);

	const startCamera = useCallback(async () => {
		if (videoRef.current === null || streamRef.current !== null) return;

		const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
		streamRef.current = stream;
		videoRef.current.srcObject = stream;
		await videoRef.current.play();
		processorRef.current.reset();
		lastVideoTimeRef.current = -1;
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

	const updateFocusPoint = async (focusPoint: typeof focusPointRef.current) => {
		focusPointRef.current = focusPoint;
		setFocusPoint(focusPoint);
	};

	const handleCanvasClick: React.MouseEventHandler<HTMLCanvasElement> = async (event) => {
		if (canvasRef.current === null) return;

		const canvas = canvasRef.current;

		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		// New selection — start the locked-on smoothing track fresh for this person.
		processorRef.current.resetFocused();
		await updateFocusPoint({ x, y });
		redisplayLastResult();
	};

	const updateFocusPointRadius = async (radius: number) => {
		focusPointRadiusRef.current = radius;
		setFocusPointRadius(radius);
		redisplayLastResult();
	};

	const handleClearFocusPoint = async () => {
		processorRef.current.resetFocused();
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
		await detectImageAndDisplayResult();
	};

	const handleVideoLoadedMetadata: React.ReactEventHandler<HTMLVideoElement> = async (event) => {
		applyMaxFocusPointRadius(event.currentTarget.videoWidth, event.currentTarget.videoHeight);

		await updateFocusPoint(null);
		lastVideoTimeRef.current = -1;
		// New clip / dimensions — drop any smoothing state carried from the previous source.
		processorRef.current.reset();
	};

	return {
		refs: { imageRef, videoRef, canvasRef },
		states: { focusPoint, focusPointRadius, maxFocusPointRadius, modelStatus, isWebcamActive, poseReadout },
		actions: {
			updateOptions,
			updateFocusPointRadius,
			startVideoDetection,
			stopVideoDetection,
			startCamera,
			stopCamera,
			updateProcessingSettings,
		},
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
