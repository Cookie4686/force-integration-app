"use client";

import { cn } from "cn";
import {
	CheckIcon,
	ChevronLeft,
	ChevronRight,
	CircleCheckIcon,
	FileTextIcon,
	HandIcon,
	Loader2Icon,
	PauseIcon,
	PlayIcon,
	RotateCcwIcon,
	RotateCwIcon,
	TriangleAlertIcon,
	Undo2Icon,
	VideoIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { RepResult, SessionDraft } from "@/lib/storage/types";

import { completeTest, removeLastRep, resetTest, saveRep } from "@/app/mrc/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import useCamera from "@/hooks/use-camera";
import usePoseStream, { PoseStreamStatus } from "@/hooks/use-pose-stream";
import { MRC_SIDE_LABEL, MRC_TESTS, MrcTest } from "@/lib/mrc/joints";
import { computeMeasure, FACING_RATIO_THRESHOLD, getShoulderWidthRatio } from "@/lib/mrc/measure";
import { mrcSessionHref, mrcTestHref } from "@/lib/mrc/routes";
import { buildMetrics, createMockSession, MrcSession } from "@/lib/mrc/session";
import { roundRecordingRow, summarizeRep } from "@/lib/mrc/summary";

import CameraView from "./camera-view";
import PoseOverlay, { LEVEL_COLOR } from "./pose-overlay";
import { AngleDashboardCard, FormStatusCard, RecommendationsCard, SessionCard } from "./session-cards";

// Live values refresh (and are recorded during a repetition) at this interval.
const SAMPLE_INTERVAL_MS = 100;

type SaveState = "idle" | "saving" | "saved" | "error";
type SaveTask = (session: SessionDraft) => Promise<unknown>;

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
	savedRepDurationsMs = [],
}: {
	test: MrcTest;
	isSequence: boolean;
	isManual: boolean;
	nextTest?: MrcTest;
	// Where to save results (from the start popup). Without it, nothing is saved.
	session?: SessionDraft;
	// Reps of this test already saved in the session (continuing a record); counting resumes after them.
	savedRepDurationsMs?: number[];
}) {
	const { joint } = test;
	// TODO: replace the mock with live data from the pose model.
	const [session, setSession] = useState<MrcSession>(() => createMockSession(test));
	const camera = useCamera();
	const pose = usePoseStream(camera.videoRef);

	// Live measure values from the (smoothed) pose, refreshed 10× per second for the dashboard.
	const [liveValues, setLiveValues] = useState<(number | null)[]>([]);
	// Shoulder width ÷ trunk length: small = side-on, large = facing the camera.
	const [viewRatio, setViewRatio] = useState<number | null>(null);
	// Values recorded during the current repetition: [sample][measure].
	const recordingRef = useRef<(number | null)[][]>([]);
	const isRecordingRef = useRef(false);
	useEffect(() => {
		const timer = setInterval(() => {
			const frame = pose.frameRef.current;
			const values = test.measures.map((measure) => computeMeasure(measure, frame));
			setLiveValues(values);
			setViewRatio(getShoulderWidthRatio(frame));
			if (isRecordingRef.current) recordingRef.current.push(roundRecordingRow(values));
		}, SAMPLE_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [pose.frameRef, test.measures]);
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
	const index = MRC_TESTS.findIndex(({ id }) => id === test.id);

	// --- Manual mode (no force device): the doctor taps the screen to start/stop each repetition.
	const [repDurationsMs, setRepDurationsMs] = useState<number[]>(savedRepDurationsMs);
	const [repStartedAt, setRepStartedAt] = useState<number | null>(null);
	const [now, setNow] = useState(0);
	const repsDone = repDurationsMs.length;
	const isRepActive = repStartedAt !== null;
	const isFinished = repsDone >= joint.repetitions;

	// Tick the on-screen timer while a repetition is being recorded.
	useEffect(() => {
		if (repStartedAt === null) return;
		const timer = setInterval(() => setNow(performance.now()), 100);
		return () => clearInterval(timer);
	}, [repStartedAt]);

	const repStartedIsoRef = useRef("");

	// --- Saving (app/mrc/actions.ts): manual mode with a session from the /mrc page.
	const sessionId = sessionDraft?.id;
	const canSave = isManual && sessionDraft !== undefined;
	const [saveState, setSaveState] = useState<SaveState>(savedRepDurationsMs.length > 0 ? "saved" : "idle");
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
		if (!isManual || sessionDraft === undefined) return;
		setSaveState("saving");
		runSave(sessionDraft, task);
	};
	const retrySave = () => {
		if (failedSaveRef.current) persist(failedSaveRef.current);
	};

	const toggleRep = () => {
		if (isFinished) return;
		const time = performance.now();
		if (repStartedAt === null) {
			recordingRef.current = [];
			isRecordingRef.current = true;
			repStartedIsoRef.current = new Date().toISOString();
			setRepStartedAt(time);
			setNow(time);
		} else {
			isRecordingRef.current = false;
			const durationMs = time - repStartedAt;
			const values = recordingRef.current;
			setRepDurationsMs((prev) => [...prev, durationMs]);
			setRepStartedAt(null);

			const rep: RepResult = {
				index: repsDone + 1,
				startedAt: repStartedIsoRef.current,
				durationMs: Math.round(durationMs),
				metrics: summarizeRep(test.measures, values),
				recording: { intervalMs: SAMPLE_INTERVAL_MS, values },
			};
			persist((draft) => saveRep(draft, test.id, rep));
			if (repsDone + 1 >= joint.repetitions) persist((draft) => completeTest(draft.id, test.id));
		}
	};

	const undoRep = () => {
		setRepDurationsMs((prev) => prev.slice(0, -1));
		persist((draft) => removeLastRep(draft.id, test.id));
	};

	const reset = () => {
		setSession(createMockSession(test));
		setRepDurationsMs([]);
		setRepStartedAt(null);
		isRecordingRef.current = false;
		recordingRef.current = [];
		persist((draft) => resetTest(draft.id, test.id));
	};

	// In manual mode, repetitions / timeline / status come from the doctor's taps.
	const shownSession: MrcSession =
		isManual ?
			{
				...session,
				repetitionsDone: repsDone,
				progress: repsDone / joint.repetitions,
				status:
					isFinished ? "finished"
					: isRepActive || repsDone > 0 ? "running"
					: "ready",
			}
		:	session;

	const setStatus = (status: MrcSession["status"]) => setSession((prev) => ({ ...prev, status }));

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
					{isManual && (
						<Badge variant="secondary">
							<HandIcon />
							Without force
						</Badge>
					)}
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

			{isManual && sessionId === undefined && (
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
			{!isManual && sessionId !== undefined && (
				<div className="text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-2 text-sm">
					<TriangleAlertIcon className="size-4 shrink-0" />
					Results are not saved in force-device mode yet.
				</div>
			)}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
				{/* Left: camera + controls */}
				<div className="flex flex-col gap-4">
					<CameraView
						camera={camera}
						overlay={<PoseOverlay frameRef={pose.frameRef} measures={test.measures} />}
						onScreenClick={isManual ? toggleRep : undefined}
					>
						<div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
							<Badge className={poseBadge.className}>{poseBadge.label}</Badge>
							{isViewCorrect !== null && (
								<Badge className={isViewCorrect ? "bg-green-600 text-white" : "bg-amber-500 text-white"}>
									{viewLabel} ({viewRatio?.toFixed(2)})
								</Badge>
							)}
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
								{shownSession.repetitionsDone} / {joint.repetitions}
							</p>
						</div>

						{isManual && (
							<>
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
											Repetition {repsDone + 1} · {((now - repStartedAt) / 1000).toFixed(1)} s — tap to stop
										</>
									:	<>
											<HandIcon className="size-5" />
											Tap the screen to start repetition {repsDone + 1}
										</>
									}
								</div>
							</>
						)}
					</CameraView>

					<div className="flex flex-wrap items-center gap-2">
						{isManual ?
							<Button size="lg" variant="outline" disabled={repsDone === 0 || isRepActive} onClick={undoRep}>
								<Undo2Icon />
								Undo last repetition
							</Button>
						: session.status === "running" ?
							<Button size="lg" variant="secondary" onClick={() => setStatus("paused")}>
								<PauseIcon />
								Pause
							</Button>
						:	<Button size="lg" onClick={() => setStatus("running")}>
								<PlayIcon />
								{session.status === "paused" ? "Resume" : "Start"}
							</Button>
						}
						<Button size="lg" variant="outline" onClick={reset}>
							<RotateCcwIcon />
							Reset
						</Button>

						{canSave && sessionId !== undefined && isFinished && !isSequence && (
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
									variant: isManual && isFinished ? "default" : "outline",
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
				</div>

				{/* Right: session information */}
				<div className="flex flex-col gap-4">
					<SessionCard
						session={shownSession}
						repetitions={joint.repetitions}
						repDurationsMs={isManual ? repDurationsMs : undefined}
					/>
					<AngleDashboardCard metrics={liveMetrics} />
					<FormStatusCard form={session.form} />
					<RecommendationsCard recommendations={session.recommendations} />
				</div>
			</div>
		</div>
	);
}
