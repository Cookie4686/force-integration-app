"use client";

import { cn } from "cn";
import {
	BluetoothIcon,
	CheckIcon,
	ChevronLeft,
	ChevronRight,
	CircleCheckIcon,
	FileTextIcon,
	HandIcon,
	InfoIcon,
	Loader2Icon,
	RotateCcwIcon,
	RotateCwIcon,
	TriangleAlertIcon,
	Undo2Icon,
	VideoIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { RepForce, RepResult, SessionDraft } from "@/lib/storage/types";

import { completeTest, removeLastRep, resetTest, saveRep } from "@/app/mrc/actions";
import CameraView from "@/components/camera/camera-view";
import MarkerOverlay from "@/components/marker/marker-overlay";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useHhdContext } from "@/context/hhd-context";
import useCamera from "@/hooks/use-camera";
import useMarkerStream from "@/hooks/use-marker-stream";
import usePoseStream, { PoseStreamStatus } from "@/hooks/use-pose-stream";
import { DEFAULT_DEVICE_MARKER_ID, DEFAULT_MARKER_SIZE_CM, findMarker } from "@/lib/marker/geometry";
import {
	ASSUMED_DEVICE_CHECK,
	checkDevicePlacement,
	DevicePlacementCheck,
	DeviceRecording,
	summarizeDevice,
	toDeviceRecordingValue,
} from "@/lib/mrc/device";
import { createForceRepDetector, FORCE_REP, getRepWarnings, summarizeForce } from "@/lib/mrc/force";
import { MRC_SIDE_LABEL, MRC_TESTS, MrcTest } from "@/lib/mrc/joints";
import { computeMeasure, FACING_RATIO_THRESHOLD, getShoulderWidthRatio } from "@/lib/mrc/measure";
import { mrcSessionHref, mrcTestHref } from "@/lib/mrc/routes";
import { buildMetrics, createMockSession, MrcRepSummary, MrcSession } from "@/lib/mrc/session";
import { roundRecordingRow, summarizeRep } from "@/lib/mrc/summary";

import DeviceOverlay from "./device-overlay";
import { DEVICE_STATUS_STYLE, DevicePositionCard, ForceCard } from "./force-cards";
import PoseOverlay, { LEVEL_COLOR } from "./pose-overlay";
import { AngleDashboardCard, FormStatusCard, RecommendationsCard, SessionCard } from "./session-cards";

// Live values refresh (and are recorded during a repetition) at this interval.
// In force-device mode the force reading is also checked for pushes at this pace.
const SAMPLE_INTERVAL_MS = 100;

// Force-device mode tracks the small device marker too: it needs every pixel.
const FORCE_CAMERA_RESOLUTION = { width: 1920, height: 1080 };

// Time since a performance.now() timestamp (called from event handlers and timers only).
const msSince = (start: number) => performance.now() - start;

type SaveState = "idle" | "saving" | "saved" | "error";
type SaveTask = (session: SessionDraft) => Promise<unknown>;

// Message under the camera about the last repetition (warnings, ignored push, …).
type Notice = { tone: "warning" | "info"; title: string; items: string[] };

const POSE_BADGE: Record<PoseStreamStatus | "tracking" | "no-person", { label: string; className: string }> = {
	loading: { label: "Loading pose model…", className: "bg-black/70 text-white" },
	error: { label: "Pose model failed to load", className: "bg-red-600 text-white" },
	ready: { label: "Pose model ready", className: "bg-black/70 text-white" },
	tracking: { label: "Tracking", className: "bg-green-600 text-white" },
	"no-person": { label: "No person detected", className: "bg-amber-500 text-white" },
};

export default function JointTest({
	test,
	isSequence,
	isManual,
	nextTest,
	session: sessionDraft,
	savedReps = [],
}: {
	test: MrcTest;
	isSequence: boolean;
	isManual: boolean;
	nextTest?: MrcTest;
	// Where to save results (from the start popup). Without it, nothing is saved.
	session?: SessionDraft;
	// Reps of this test already saved in the session (continuing a record); counting resumes after them.
	savedReps?: MrcRepSummary[];
}) {
	const { joint } = test;
	// TODO: replace the mock form status / recommendations with live data.
	const [mockSession] = useState<MrcSession>(() => createMockSession(test));
	const camera = useCamera(isManual ? undefined : FORCE_CAMERA_RESOLUTION);
	const pose = usePoseStream(camera.videoRef);
	// Force-device mode: the device (marker tracking) and its force reading (shared connection, see app/mrc/layout.tsx).
	const marker = useMarkerStream(camera.videoRef, !isManual);
	const hhd = useHhdContext();

	// --- Repetitions: manual mode = the doctor taps the screen; force mode = a push on the device.
	const [reps, setReps] = useState<MrcRepSummary[]>(savedReps);
	const [repStartedAt, setRepStartedAt] = useState<number | null>(null);
	const [now, setNow] = useState(0);
	const [notice, setNotice] = useState<Notice | null>(null);
	const repsDone = reps.length;
	const isRepActive = repStartedAt !== null;
	const isFinished = repsDone >= joint.repetitions;

	// Tick the on-screen timer while a repetition is being recorded.
	useEffect(() => {
		if (repStartedAt === null) return;
		const timer = setInterval(() => setNow(performance.now()), 100);
		return () => clearInterval(timer);
	}, [repStartedAt]);

	// Values recorded during the current repetition: [sample][measure], and the device position per sample.
	const recordingRef = useRef<(number | null)[][]>([]);
	const deviceRowsRef = useRef<DeviceRecording>([]);
	const isRecordingRef = useRef(false);
	const repStartedIsoRef = useRef("");

	// --- Saving (app/mrc/actions.ts): with a session from the /mrc page.
	const sessionId = sessionDraft?.id;
	const canSave = sessionDraft !== undefined;
	const [saveState, setSaveState] = useState<SaveState>(savedReps.length > 0 ? "saved" : "idle");
	// Saves run one after another, in the order they were made.
	const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
	const failedSaveRef = useRef<SaveTask | null>(null);

	const runSave = (draft: SessionDraft, task: SaveTask) => {
		saveChainRef.current = saveChainRef.current
			.then(() => task(draft))
			.then(
				() => {
					failedSaveRef.current = null;
					setSaveState("saved");
				},
				() => {
					failedSaveRef.current = task;
					setSaveState("error");
				}
			);
	};
	const persist = (task: SaveTask) => {
		if (sessionDraft === undefined) return;
		setSaveState("saving");
		runSave(sessionDraft, task);
	};
	const retrySave = () => {
		if (failedSaveRef.current) persist(failedSaveRef.current);
	};

	const beginRep = () => {
		recordingRef.current = [];
		deviceRowsRef.current = [];
		isRecordingRef.current = true;
		repStartedIsoRef.current = new Date().toISOString();
		const time = performance.now();
		setRepStartedAt(time);
		setNow(time);
		setNotice(null);
	};

	// Stop recording without counting the repetition.
	const cancelRep = () => {
		isRecordingRef.current = false;
		setRepStartedAt(null);
		setActivePeakKg(null);
	};

	// Count and save the repetition. Force-device mode gives the push's duration
	// and force (device clock); manual mode times it from the tap that started it.
	const finishRep = (push?: { durationMs: number; force: RepForce }) => {
		isRecordingRef.current = false;
		const durationMs = push?.durationMs ?? (repStartedAt === null ? 0 : msSince(repStartedAt));
		const force = push?.force;
		const values = recordingRef.current;
		const metrics = summarizeRep(test.measures, values);
		const index = repsDone + 1;
		let rep: RepResult = {
			index,
			startedAt: repStartedIsoRef.current,
			durationMs: Math.round(durationMs),
			metrics,
			recording: { intervalMs: SAMPLE_INTERVAL_MS, values },
		};
		if (force) {
			const deviceRows = deviceRowsRef.current;
			const device =
				markerSeenRef.current ? summarizeDevice(deviceRows) : { seenPct: 0, inPlacePct: null, assumed: true };
			const warnings = getRepWarnings({ force, device, metrics });
			rep = {
				...rep,
				recording: markerSeenRef.current ? { ...rep.recording, device: deviceRows } : rep.recording,
				force,
				device,
				warnings,
			};
			if (warnings.length > 0)
				setNotice({ tone: "warning", title: `Repetition ${index} — please check`, items: warnings });
		}
		setReps((prev) => [...prev, { durationMs: rep.durationMs, peakKg: force?.peakKg, warnings: rep.warnings }]);
		setRepStartedAt(null);
		setActivePeakKg(null);
		persist((draft) => saveRep(draft, test.id, rep));
		if (index >= joint.repetitions) persist((draft) => completeTest(draft.id, test.id));
	};

	// Manual mode: tap to start, tap again to stop.
	const toggleRep = () => {
		if (isFinished) return;
		if (repStartedAt === null) beginRep();
		else finishRep();
	};

	const undoRep = () => {
		setReps((prev) => prev.slice(0, -1));
		setNotice(null);
		persist((draft) => removeLastRep(draft.id, test.id));
	};

	const reset = () => {
		cancelRep();
		setReps([]);
		setNotice(null);
		recordingRef.current = [];
		persist((draft) => resetTest(draft.id, test.id));
	};

	// --- Live values, 10× per second: posture measures, device position, force pushes.
	const [liveValues, setLiveValues] = useState<(number | null)[]>([]);
	// Shoulder width ÷ trunk length: small = side-on, large = facing the camera.
	const [viewRatio, setViewRatio] = useState<number | null>(null);
	const [deviceCheck, setDeviceCheck] = useState<DevicePlacementCheck>(ASSUMED_DEVICE_CHECK);
	// Until the marker is seen once, the doctor may not be using one: the position is assumed correct.
	const markerSeenRef = useRef(false);
	const [markerSidePx, setMarkerSidePx] = useState<number | null>(null);
	const [activePeakKg, setActivePeakKg] = useState<number | null>(null);
	const [detector] = useState(createForceRepDetector);
	// Device timestamp of the last force sample looked at (null = start from the newest).
	const lastForceTsRef = useRef<number | null>(null);

	// Look for pushes in the force samples that arrived since the last tick.
	const processForce = () => {
		if (hhd.connection !== "connected") {
			if (isRecordingRef.current) {
				cancelRep();
				setNotice({
					tone: "warning",
					title: "Force device disconnected",
					items: ["The repetition in progress was not counted. Reconnect and repeat it."],
				});
			}
			lastForceTsRef.current = null;
			detector.reset();
			return;
		}
		const samples = hhd.samplesRef.current;
		const latest = samples[samples.length - 1];
		if (!latest) return;
		const lastTs = lastForceTsRef.current;
		lastForceTsRef.current = latest.timestampMs;
		// First look at this stream (or it restarted): older samples belong to before this test.
		if (lastTs === null || latest.timestampMs < lastTs) {
			detector.reset();
			return;
		}

		let first = samples.length;
		while (first > 0 && samples[first - 1].timestampMs > lastTs) first--;
		let finishedNow = false;
		for (let i = first; i < samples.length; i++) {
			const event = detector.push(samples[i]);
			if (event === null) continue;
			if (event.type === "start") {
				if (!isFinished && !finishedNow) beginRep();
			} else if (isRecordingRef.current) {
				if (event.type === "end") {
					finishRep({ durationMs: event.durationMs, force: summarizeForce(event.samples) });
					finishedNow = true;
				} else {
					cancelRep();
					setNotice({
						tone: "info",
						title: "Push too short — not counted",
						items: [
							`The force was over ${FORCE_REP.startKg} kg for only ${(event.durationMs / 1000).toFixed(1)} s (at least ${FORCE_REP.minDurationMs / 1000} s needed).`,
						],
					});
				}
			}
		}
		if (isRecordingRef.current) setActivePeakKg(detector.peakKg());
	};

	const onTick = useEffectEvent(() => {
		const frame = pose.frameRef.current;
		const values = test.measures.map((measure) => computeMeasure(measure, frame));
		setLiveValues(values);
		setViewRatio(getShoulderWidthRatio(frame));

		let deviceValue: boolean | null = null;
		if (!isManual) {
			const device = findMarker(marker.frameRef.current, DEFAULT_DEVICE_MARKER_ID);
			if (device) markerSeenRef.current = true;
			const check =
				markerSeenRef.current ?
					checkDevicePlacement(test.device, frame, device, DEFAULT_MARKER_SIZE_CM)
				:	ASSUMED_DEVICE_CHECK;
			setDeviceCheck(check);
			setMarkerSidePx(device?.sidePx ?? null);
			deviceValue = toDeviceRecordingValue(check);
		}
		if (isRecordingRef.current) {
			recordingRef.current.push(roundRecordingRow(values));
			if (!isManual) deviceRowsRef.current.push(deviceValue);
		}
		if (!isManual) processForce();
	});
	useEffect(() => {
		const timer = setInterval(() => onTick(), SAMPLE_INTERVAL_MS);
		return () => clearInterval(timer);
	}, []);

	const liveMetrics = buildMetrics(test.measures, liveValues);
	const sideLabel = MRC_SIDE_LABEL[test.side].toLowerCase();
	// Is the patient turned the way this test needs (side-on, or facing the camera)?
	const isSideView = joint.camera === "side";
	const isViewCorrect =
		viewRatio === null ? null
		: isSideView ? viewRatio <= FACING_RATIO_THRESHOLD
		: viewRatio > FACING_RATIO_THRESHOLD;
	const viewLabel =
		isSideView ?
			isViewCorrect ? "Side-on"
			:	"Not side-on"
		: isViewCorrect ? "Facing camera"
		: "Not facing camera";
	const turnMessage =
		isSideView ?
			`Turn the patient side-on — ${sideLabel} side toward the camera`
		:	"Turn the patient to face the camera";
	const poseBadge =
		POSE_BADGE[
			pose.status !== "ready" ? pose.status
			: pose.hasPerson ? "tracking"
			: "no-person"
		];
	const deviceBadge = DEVICE_STATUS_STYLE[deviceCheck.status];
	const isForceConnected = hhd.connection === "connected";
	const index = MRC_TESTS.findIndex(({ id }) => id === test.id);

	// Repetitions / timeline / status come from the finished repetitions.
	const shownSession: MrcSession = {
		...mockSession,
		repetitionsDone: repsDone,
		progress: repsDone / joint.repetitions,
		status:
			isFinished ? "finished"
			: isRepActive || repsDone > 0 ? "running"
			: "ready",
	};

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6">
			{/* Top bar: back + sequence progress */}
			<div className="flex items-center justify-between gap-4">
				<Link className={buttonVariants({ variant: "outline" })} href="/mrc">
					<ChevronLeft size={16} />
					<span>{isSequence ? "Exit full test" : "Back to joints"}</span>
				</Link>
				{isSequence && (
					<div className="flex items-center gap-3">
						<span className="text-muted-foreground text-sm font-medium">
							Test {index + 1} of {MRC_TESTS.length}
						</span>
						<div className="flex gap-1">
							{MRC_TESTS.map(({ id }, idx) => (
								<div
									className={cn(
										"h-1.5 w-3 rounded-full",
										idx < index ? "bg-primary"
										: idx === index ? "bg-primary/50"
										: "bg-muted"
									)}
									key={id}
								/>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Current activity */}
			<div className="flex flex-col gap-1">
				<span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Current Activity</span>
				<div className="flex flex-wrap items-center gap-3">
					<h2 className="text-3xl font-bold">
						{MRC_SIDE_LABEL[test.side]} {joint.name} Test
					</h2>
					<Badge>{MRC_SIDE_LABEL[test.side]} side</Badge>
					<Badge variant="outline">{joint.region}</Badge>
					<Badge variant="outline">
						<VideoIcon />
						{joint.camera === "side" ? `Camera on the patient's ${sideLabel} side` : "Camera in front of the patient"}
					</Badge>
					<Badge variant="secondary">
						{isManual ?
							<HandIcon />
						:	<BluetoothIcon />}
						{isManual ? "Without force" : "With force device"}
					</Badge>
					{canSave
						&& (saveState === "error" ?
							<Button size="sm" variant="destructive" onClick={retrySave}>
								<TriangleAlertIcon />
								Save failed — retry
							</Button>
						:	<Badge variant="outline">
								{saveState === "saving" ?
									<Loader2Icon className="animate-spin" />
								: saveState === "saved" ?
									<CheckIcon />
								:	null}
								{saveState === "saving" ?
									"Saving…"
								: saveState === "saved" ?
									"Saved"
								:	"Saved after the first repetition"}
							</Badge>)}
				</div>
			</div>

			{sessionId === undefined && (
				<div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
					<TriangleAlertIcon className="size-4 shrink-0 text-amber-600" />
					<span>
						Not saving — choose a patient on the{" "}
						<Link className="font-medium underline" href="/mrc">
							MRC page
						</Link>{" "}
						and start the test from there.
					</span>
				</div>
			)}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
				{/* Left: camera + controls (+ force) */}
				<div className="flex flex-col gap-4">
					<CameraView
						camera={camera}
						overlay={
							<>
								<PoseOverlay frameRef={pose.frameRef} measures={test.measures} />
								{!isManual && (
									<>
										<DeviceOverlay
											poseFrameRef={pose.frameRef}
											markerFrameRef={marker.frameRef}
											placement={test.device}
											deviceMarkerId={DEFAULT_DEVICE_MARKER_ID}
											markerSizeCm={DEFAULT_MARKER_SIZE_CM}
										/>
										<MarkerOverlay frameRef={marker.frameRef} deviceMarkerId={DEFAULT_DEVICE_MARKER_ID} />
									</>
								)}
							</>
						}
						onScreenClick={isManual ? toggleRep : undefined}
					>
						<div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
							<Badge className={poseBadge.className}>{poseBadge.label}</Badge>
							{isViewCorrect !== null && (
								<Badge className={isViewCorrect ? "bg-green-600 text-white" : "bg-amber-500 text-white"}>
									{viewLabel} ({viewRatio?.toFixed(2)})
								</Badge>
							)}
							{!isManual && <Badge className={deviceBadge.badge}>{deviceBadge.label}</Badge>}
							{test.measures.length > 0 && (
								<Badge className="gap-2 bg-black/70 text-white">
									{(
										[
											["good", "On target"],
											["warning", "Adjust"],
											["bad", "Off"],
										] as const
									).map(([level, label]) => (
										<span className="flex items-center gap-1" key={level}>
											<span className="size-2 rounded-full" style={{ backgroundColor: LEVEL_COLOR[level] }} />
											{label}
										</span>
									))}
								</Badge>
							)}
						</div>
						{isViewCorrect === false && (
							<div className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-1/2 items-center gap-2 rounded-lg bg-amber-500/95 px-5 py-3 text-base font-semibold text-white shadow-lg">
								<RotateCwIcon className="size-5" />
								{turnMessage}
							</div>
						)}
						<div className="pointer-events-none absolute top-12 left-3 rounded-lg bg-black/60 px-4 py-2 text-white">
							<span className="text-xs tracking-wider text-white/70 uppercase">Repetition</span>
							<p className="text-3xl font-bold tabular-nums">
								{repsDone} / {joint.repetitions}
							</p>
						</div>

						{/* Red frame while a repetition is being recorded. */}
						{isRepActive && (
							<div className="pointer-events-none absolute inset-0 rounded-xl ring-4 ring-red-500 ring-inset" />
						)}
						<div
							className={cn(
								"pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-2.5 text-base font-semibold whitespace-nowrap text-white shadow-lg",
								isFinished ? "bg-green-600"
								: isRepActive ? "bg-red-600"
								: "bg-black/70"
							)}
						>
							{isFinished ?
								<>
									<CircleCheckIcon className="size-5" />
									Test complete — all {joint.repetitions} repetitions done
								</>
							: isRepActive ?
								<>
									<span className="size-2.5 animate-pulse rounded-full bg-white" />
									Repetition {repsDone + 1} · {((now - repStartedAt) / 1000).toFixed(1)} s
									{isManual ? " — tap to stop" : ` · ${(activePeakKg ?? 0).toFixed(1)} kg — release to finish`}
								</>
							: isManual ?
								<>
									<HandIcon className="size-5" />
									Tap the screen to start repetition {repsDone + 1}
								</>
							: isForceConnected ?
								<>
									<HandIcon className="size-5" />
									Push over {FORCE_REP.startKg} kg to start repetition {repsDone + 1}
								</>
							:	<>
									<BluetoothIcon className="size-5" />
									Connect the force device to start
								</>
							}
						</div>
					</CameraView>

					<div className="flex flex-wrap items-center gap-2">
						<Button size="lg" variant="outline" disabled={repsDone === 0 || isRepActive} onClick={undoRep}>
							<Undo2Icon />
							Undo last repetition
						</Button>
						<Button size="lg" variant="outline" onClick={reset}>
							<RotateCcwIcon />
							Reset
						</Button>

						{sessionId !== undefined && isFinished && !isSequence && (
							<Link className={buttonVariants({ size: "lg", className: "ml-auto" })} href={mrcSessionHref(sessionId)}>
								<FileTextIcon />
								View results
							</Link>
						)}

						{/* TODO: move on automatically once the session is finished. */}
						{isSequence && (
							<Link
								className={buttonVariants({
									size: "lg",
									variant: isFinished ? "default" : "outline",
									className: "ml-auto",
								})}
								href={
									nextTest ? mrcTestHref(nextTest.id, { sequence: true, manual: isManual, session: sessionDraft })
									: sessionId ?
										mrcSessionHref(sessionId)
									:	"/mrc"
								}
							>
								{nextTest ?
									<>
										<span>
											Next: {MRC_SIDE_LABEL[nextTest.side]} {nextTest.joint.name}
										</span>
										<ChevronRight size={16} />
									</>
								:	<>
										<CheckIcon size={16} />
										<span>Finish</span>
									</>
								}
							</Link>
						)}
					</div>

					{notice && (
						<div
							className={cn(
								"flex gap-2 rounded-lg border px-4 py-3 text-sm",
								notice.tone === "warning" ? "border-amber-500/50 bg-amber-500/10" : "text-muted-foreground"
							)}
						>
							{notice.tone === "warning" ?
								<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
							:	<InfoIcon className="mt-0.5 size-4 shrink-0" />}
							<div className="flex flex-col gap-1">
								<span className="text-foreground font-semibold">{notice.title}</span>
								<ul className="list-disc pl-4">
									{notice.items.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							</div>
						</div>
					)}

					{!isManual && <ForceCard hhd={hhd} activePeakKg={activePeakKg} lastPeakKg={reps[reps.length - 1]?.peakKg} />}
				</div>

				{/* Right: session information */}
				<div className="flex flex-col gap-4">
					<SessionCard session={shownSession} repetitions={joint.repetitions} reps={reps} />
					{!isManual && (
						<DevicePositionCard
							placement={test.device}
							check={deviceCheck}
							markerSidePx={markerSidePx}
							markerFailed={marker.status === "error"}
						/>
					)}
					<AngleDashboardCard metrics={liveMetrics} />
					<FormStatusCard form={mockSession.form} />
					<RecommendationsCard recommendations={mockSession.recommendations} />
				</div>
			</div>
		</div>
	);
}
