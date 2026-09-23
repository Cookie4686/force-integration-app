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
import { DEFAULT_PROCESSING_SETTINGS, PoseProcessingSettings, PoseProcessor } from "@/lib/pose/processing";

export type FocusPoint = { x: number; y: number };

type DrawOptions = {
	minVisibility?: number;
	showX: boolean;
	showY: boolean;
	showZ: boolean;
	normalized: boolean;
};

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
	// Most recently drawn landmark set (already signal-processed), so focus-point
	// and settings changes can redraw without re-running detection.
	const lastLandmarksRef = useRef<NormalizedLandmark[][] | null>(null);
	// Current processing/display settings, read live by the draw + detection paths.
	const processingSettingsRef = useRef<PoseProcessingSettings>(DEFAULT_PROCESSING_SETTINGS);

	// IMAGE, VIDEO, CANVAS, SKELETAL DISPLAY RELATED FUNCTION
	const imageRef = useRef<HTMLImageElement | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const focusPointRef = useRef<FocusPoint | null>(null);
	const focusPointRadiusRef = useRef<number>(128);
	const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);
	const [focusPointRadius, setFocusPointRadius] = useState<number>(128);
	const [maxFocusPointRadius, setMaxFocusPointRadius] = useState<number>(128);

	// Derive the current draw options (confidence gate + coordinate-label choices)
	// from the live settings, so both the image and video paths stay in sync.
	const currentDrawOptions = (): DrawOptions => {
		const s = processingSettingsRef.current;
		return {
			minVisibility: s.confidenceThreshold.enabled ? s.confidenceThreshold.value : undefined,
			showX: s.labels.showX,
			showY: s.labels.showY,
			showZ: s.labels.showZ,
			normalized: s.normalized,
		};
	};

	// Draw a set of poses onto the overlay canvas. The canvas backing store is
	// sized to the intrinsic dimensions of the source (image or video frame); it is
	// then stretched over the displayed element via CSS. When minVisibility is set,
	// landmarks (and any connection touching them) below that visibility are hidden.
	const drawResult = (
		landmarksSet: NormalizedLandmark[][],
		sourceWidth: number,
		sourceHeight: number,
		options: DrawOptions
	): void => {
		if (canvasRef.current === null || sourceWidth === 0 || sourceHeight === 0) return;

		const ctx = canvasRef.current.getContext("2d");
		if (!ctx) return;

		const { minVisibility, showX, showY, showZ, normalized } = options;

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

			// Coordinate labels: X/Y/Z text per landmark, either normalized (0..1)
			// or raw pixels (value × frame width/height). z has no true pixel unit,
			// so in raw mode it uses the width scale (MediaPipe's z convention).
			if (showX || showY || showZ) {
				// Keep on-screen text size roughly constant regardless of source resolution.
				const displayScale = sourceWidth / (canvasRef.current.clientWidth || sourceWidth);
				const fontPx = 11 * displayScale;
				ctx.font = `${fontPx}px sans-serif`;
				ctx.textBaseline = "bottom";
				ctx.lineWidth = Math.max(1, fontPx / 4);
				ctx.strokeStyle = "rgba(0,0,0,0.85)";
				ctx.fillStyle = "#ffffff";

				const fmt = (value: number) => (normalized ? value.toFixed(2) : String(Math.round(value)));

				for (const landmark of targetLandmark) {
					for (const lm of landmark) {
						if (minVisibility !== undefined && (lm.visibility ?? 1) < minVisibility) continue;

						const parts: string[] = [];
						if (showX) parts.push(`x${fmt(normalized ? lm.x : lm.x * sourceWidth)}`);
						if (showY) parts.push(`y${fmt(normalized ? lm.y : lm.y * sourceHeight)}`);
						if (showZ) parts.push(`z${fmt(normalized ? lm.z : lm.z * sourceWidth)}`);
						const text = parts.join(" ");

						const px = lm.x * sourceWidth + 4 * displayScale;
						const py = lm.y * sourceHeight - 2 * displayScale;
						ctx.strokeText(text, px, py);
						ctx.fillText(text, px, py);
					}
				}
			}
		}
	};

	const displayImageResult = (result: PoseLandmarkerResult): void => {
		if (imageRef.current === null) return;
		lastLandmarksRef.current = result.landmarks;
		drawResult(result.landmarks, imageRef.current.naturalWidth, imageRef.current.naturalHeight, currentDrawOptions());
	};

	// Redraw the most recent (processed) landmark set onto whichever source is
	// active. Used by focus-point interactions and live settings changes so the
	// overlay updates even on a paused video / still image.
	const redisplayLastResult = (): void => {
		if (lastLandmarksRef.current === null) return;
		const options = currentDrawOptions();
		if (videoRef.current !== null && videoRef.current.videoWidth > 0) {
			drawResult(lastLandmarksRef.current, videoRef.current.videoWidth, videoRef.current.videoHeight, options);
		} else if (imageRef.current !== null) {
			drawResult(lastLandmarksRef.current, imageRef.current.naturalWidth, imageRef.current.naturalHeight, options);
		}
	};

	// --- MODEL RELATED FUNCTION ---

	const [modelStatus, dispatchModelStatus] = useReducer(modelStatusReducer, { state: "load" });
	const poseWorkerRef = useRef<Comlink.Remote<PoseLandmarkerWorker>>(null);
	const isModelReadyRef = useRef<boolean>(false);
	const runningModeRef = useRef<ModelOption["runningMode"]>(initOptions.runningMode);

	// --- SIGNAL PROCESSING RELATED FUNCTION ---
	// (processingSettingsRef is declared near the top so the draw path can read it.)
	const processorRef = useRef<PoseProcessor>(new PoseProcessor());
	// Separate smoothing track + latest value for the tracked person's 3D world
	// landmarks (read by the 3D viewer's own render loop).
	const worldProcessorRef = useRef<PoseProcessor>(new PoseProcessor());
	const worldLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

	const updateProcessingSettings = useCallback((settings: PoseProcessingSettings) => {
		processingSettingsRef.current = settings;
		// Redraw immediately so label/normalization/threshold changes show up even on
		// a still image or a paused video (the video loop already redraws each frame).
		redisplayLastResult();
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
			worldProcessorRef.current.reset();
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
						const worldPoses = response.result.worldLandmarks;
						const canvas = canvasRef.current;
						const cw = canvas.clientWidth;
						const ch = canvas.clientHeight;
						const focus = focusPointRef.current;

						let drawSet: NormalizedLandmark[][];
						let targetIndex = -1;

						if (focus !== null) {
							// Static reference: the focus point stays exactly where the user
							// placed it (e.g. on the seated patient). Each frame we pick the
							// person currently nearest that fixed point, so a doctor moving
							// through the scene can never drag the tracked position away —
							// once they step aside, the patient by the reference is selected
							// again.
							let bestDistance: number | null = null;
							if (cw > 0 && ch > 0) {
								for (let i = 0; i < rawPoses.length; i++) {
									const px = rawPoses[i][0].x * cw;
									const py = rawPoses[i][0].y * ch;
									const distance = Math.hypot(px - focus.x, py - focus.y);
									if (
										distance <= focusPointRadiusRef.current
										&& (bestDistance === null || distance < bestDistance)
									) {
										bestDistance = distance;
										targetIndex = i;
									}
								}
							}

							if (targetIndex >= 0) {
								drawSet = [processorRef.current.processSingle(rawPoses[targetIndex], settings, now / 1000)];
							} else {
								// Nobody within range of the reference — hide the skeleton until
								// someone is near it again. The focus point does not move.
								drawSet = [];
							}
						} else {
							drawSet = processorRef.current.process(rawPoses, settings, now / 1000);
							targetIndex = rawPoses.length > 0 ? 0 : -1;
						}

						// Feed the 3D viewer the tracked person's smoothed world landmarks.
						if (targetIndex >= 0 && worldPoses[targetIndex]) {
							worldLandmarksRef.current = worldProcessorRef.current.processSingle(
								worldPoses[targetIndex],
								settings,
								now / 1000
							);
						} else {
							worldLandmarksRef.current = null;
						}

						lastLandmarksRef.current = drawSet;

						dispatchModelStatus({ state: "inference_finished", inferenceTime: response.inferenceTime });
						drawResult(drawSet, video.videoWidth, video.videoHeight, currentDrawOptions());
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
		worldProcessorRef.current.reset();
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
		worldProcessorRef.current.resetFocused();
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
		worldProcessorRef.current.resetFocused();
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
		worldProcessorRef.current.reset();
	};

	return {
		refs: { imageRef, videoRef, canvasRef, worldLandmarksRef },
		states: { focusPoint, focusPointRadius, maxFocusPointRadius, modelStatus, isWebcamActive },
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
