"use client";

import { cn } from "cn";
import {
	CircleCheckIcon,
	HandIcon,
	InfoIcon,
	Loader2Icon,
	PauseIcon,
	PlayIcon,
	RotateCcwIcon,
	SaveIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { HhdSample } from "@/lib/hhd/protocol";
import type { RepResult } from "@/lib/storage/types";

import DeviceOverlay from "@/app/mrc/[test]/device-overlay";
import { DEVICE_STATUS_STYLE, DevicePositionCard } from "@/app/mrc/[test]/force-cards";
import PoseOverlay from "@/app/mrc/[test]/pose-overlay";
import { AngleDashboardCard, SessionCard } from "@/app/mrc/[test]/session-cards";
import { saveVideoSession } from "@/app/mrc/actions";
import { PatientDialog } from "@/app/mrc/start-test-dialog";
import ForceGraph from "@/components/force/force-graph";
import MarkerOverlay from "@/components/marker/marker-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import useMarkerStream from "@/hooks/use-marker-stream";
import usePoseStream from "@/hooks/use-pose-stream";
import { ForceRecording } from "@/lib/hhd/recording";
import { DEFAULT_DEVICE_MARKER_ID, DEFAULT_MARKER_SIZE_CM, findMarker } from "@/lib/marker/geometry";
import {
	ASSUMED_DEVICE_CHECK,
	checkDevicePlacement,
	DevicePlacementCheck,
	DeviceRecording,
	toDeviceRecordingValue,
} from "@/lib/mrc/device";
import { createForceRepDetector, FORCE_GRAPH_WINDOW_SECONDS, FORCE_REP, summarizeForce } from "@/lib/mrc/force";
import { MRC_SIDE_LABEL, MrcTest } from "@/lib/mrc/joints";
import { computeMeasure } from "@/lib/mrc/measure";
import { buildRepResult } from "@/lib/mrc/rep";
import { mrcSessionHref } from "@/lib/mrc/routes";
import { buildMetrics, createMockSession, MrcSession } from "@/lib/mrc/session";
import { roundRecordingRow } from "@/lib/mrc/summary";

// Same pace as the realtime test: measures are sampled (and recorded) every 100 ms.
const SAMPLE_INTERVAL_MS = 100;

type Phase = "loading" | "playing" | "paused" | "done" | "error";
type Notice = { tone: "warning" | "info"; title: string; items: string[] };

const formatKg = (kg: number | null | undefined) => (kg === null || kg === undefined ? "—" : `${kg.toFixed(1)} kg`);

// Plays the video through the same pose model, device tracker and push detection
// as the realtime test. The force file is replayed in step with the video: the
// force sample at time t belongs to the video frame at time t (both start at 0).
export default function VideoAnalysis({
	test,
	videoUrl,
	videoName,
	recording,
	repetitions,
	customRepetitions,
	onRestart,
}: {
	test: MrcTest;
	// Repetitions needed (custom or the joint's default) and the custom value alone, if any.
	repetitions: number;
	customRepetitions: number | undefined;
	videoUrl: string;
	videoName: string;
	recording: ForceRecording;
	onRestart: () => void;
}) {
	const { joint } = test;
	const router = useRouter();
	const videoRef = useRef<HTMLVideoElement>(null);
	const pose = usePoseStream(videoRef);
	const marker = useMarkerStream(videoRef);
	const [mockSession] = useState<MrcSession>(() => createMockSession(test));

	const [phase, setPhase] = useState<Phase>("loading");
	const [videoMs, setVideoMs] = useState(0);
	const [durationMs, setDurationMs] = useState(0);
	const [reps, setReps] = useState<RepResult[]>([]);
	// Push in progress: when it started (video time) and its peak so far.
	const [activeRep, setActiveRep] = useState<{ startMs: number; peakKg: number } | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [liveValues, setLiveValues] = useState<(number | null)[]>([]);
	const [deviceCheck, setDeviceCheck] = useState<DevicePlacementCheck>(ASSUMED_DEVICE_CHECK);
	const [markerSidePx, setMarkerSidePx] = useState<number | null>(null);
	const [currentKg, setCurrentKg] = useState<number | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const [detector] = useState(createForceRepDetector);
	// Force samples replayed so far (drawn on the graph) and the next one to replay.
	const replayedRef = useRef<HhdSample[]>([]);
	const nextSampleRef = useRef(0);
	const recordingRef = useRef<(number | null)[][]>([]);
	const deviceRowsRef = useRef<DeviceRecording>([]);
	const isRecordingRef = useRef(false);
	const repStartedIsoRef = useRef("");
	// Until the device marker is seen once, its position is assumed correct (as in the realtime test).
	const markerSeenRef = useRef(false);

	const isFinished = reps.length >= repetitions;

	// Start playing once the pose model is ready, so no frame is missed.
	useEffect(() => {
		if (phase !== "loading") return;
		if (pose.status === "error") {
			queueMicrotask(() => setPhase("error"));
			return;
		}
		const video = videoRef.current;
		if (pose.status !== "ready" || !video) return;
		video.play().then(
			() => setPhase("playing"),
			() => setPhase("paused")
		);
	}, [pose.status, phase]);

	const togglePlay = () => {
		const video = videoRef.current;
		if (!video) return;
		if (phase === "playing") {
			video.pause();
			setPhase("paused");
		} else if (phase === "paused") {
			video.play().then(() => setPhase("playing"));
		}
	};

	const cancelRep = (next: Notice) => {
		isRecordingRef.current = false;
		setActiveRep(null);
		setNotice(next);
	};

	const onTick = useEffectEvent(() => {
		const video = videoRef.current;
		if (!video || phase === "loading" || phase === "error") return;
		const nowMs = video.currentTime * 1000;
		setVideoMs(nowMs);

		// Posture + device position, exactly as in the realtime test.
		const frame = pose.frameRef.current;
		const values = test.measures.map((measure) => computeMeasure(measure, frame));
		setLiveValues(values);
		const device = findMarker(marker.frameRef.current, DEFAULT_DEVICE_MARKER_ID);
		if (device) markerSeenRef.current = true;
		const check =
			markerSeenRef.current ?
				checkDevicePlacement(test.device, frame, device, DEFAULT_MARKER_SIZE_CM)
			:	ASSUMED_DEVICE_CHECK;
		setDeviceCheck(check);
		setMarkerSidePx(device?.sidePx ?? null);
		if (isRecordingRef.current && !video.paused && !video.ended) {
			recordingRef.current.push(roundRecordingRow(values));
			deviceRowsRef.current.push(toDeviceRecordingValue(check));
		}

		// Replay the force samples up to the current video time.
		const samples = recording.samples;
		let count = reps.length;
		while (nextSampleRef.current < samples.length && samples[nextSampleRef.current].timestampMs <= nowMs) {
			const sample = samples[nextSampleRef.current++];
			replayedRef.current.push(sample);
			setCurrentKg(sample.forceKg);
			const event = detector.push(sample);
			if (event === null) continue;
			if (event.type === "start") {
				if (count >= repetitions) continue;
				recordingRef.current = [];
				deviceRowsRef.current = [];
				isRecordingRef.current = true;
				repStartedIsoRef.current = new Date().toISOString();
				setActiveRep({ startMs: sample.timestampMs, peakKg: sample.forceKg });
				setNotice(null);
			} else if (!isRecordingRef.current) {
				continue;
			} else if (event.type === "discard") {
				cancelRep({
					tone: "info",
					title: "Push too short — not counted",
					items: [
						`The force was over ${FORCE_REP.startKg} kg for only ${(event.durationMs / 1000).toFixed(1)} s (at least ${FORCE_REP.minDurationMs / 1000} s needed).`,
					],
				});
			} else {
				isRecordingRef.current = false;
				count++;
				const rep = buildRepResult({
					index: count,
					startedAt: repStartedIsoRef.current,
					durationMs: event.durationMs,
					measures: test.measures,
					values: recordingRef.current,
					intervalMs: SAMPLE_INTERVAL_MS,
					push: {
						force: summarizeForce(event.samples),
						deviceRows: deviceRowsRef.current,
						markerSeen: markerSeenRef.current,
					},
				});
				setReps((prev) => [...prev, rep]);
				setActiveRep(null);
				if (rep.warnings && rep.warnings.length > 0)
					setNotice({ tone: "warning", title: `Repetition ${count} — please check`, items: rep.warnings });
			}
		}
		const peakKg = detector.peakKg();
		if (isRecordingRef.current && peakKg !== null) setActiveRep((prev) => prev && { ...prev, peakKg });
	});
	useEffect(() => {
		const timer = setInterval(() => onTick(), SAMPLE_INTERVAL_MS);
		return () => clearInterval(timer);
	}, []);

	const onEnded = () => {
		if (isRecordingRef.current)
			cancelRep({
				tone: "warning",
				title: "The video ended during a push",
				items: ["That last push was not counted."],
			});
		setPhase("done");
	};

	const save = async (patientId: string, testName: string) => {
		const id = await saveVideoSession({
			patientId,
			name: testName,
			testId: test.id,
			videoName,
			repetitions: customRepetitions,
			reps,
		});
		router.push(mrcSessionHref(id));
	};

	const liveMetrics = buildMetrics(test.measures, liveValues);
	const deviceBadge = DEVICE_STATUS_STYLE[deviceCheck.status];
	const title = `${MRC_SIDE_LABEL[test.side]} ${joint.name}`;
	const shownSession: MrcSession = {
		...mockSession,
		repetitionsDone: reps.length,
		progress: reps.length / repetitions,
		status:
			isFinished || phase === "done" ? "finished"
			: phase === "paused" ? "paused"
			: phase === "playing" ? "running"
			: "ready",
	};

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
			{isSaving && (
				<PatientDialog
					title="Save result"
					description={`${title} · from video (${videoName})`}
					defaultName={`${title} (video)`}
					submitLabel="Save"
					submitIcon={SaveIcon}
					onSubmit={save}
					onClose={() => setIsSaving(false)}
				/>
			)}

			{/* Left: video + controls + force */}
			<div className="flex flex-col gap-4">
				<div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black select-none">
					<video
						className="absolute inset-0 h-full w-full object-contain"
						ref={videoRef}
						src={videoUrl}
						muted
						playsInline
						onLoadedMetadata={(event) => setDurationMs(event.currentTarget.duration * 1000)}
						onEnded={onEnded}
					/>
					{/* The video is not mirrored (unlike the live camera). */}
					<PoseOverlay frameRef={pose.frameRef} measures={test.measures} mirrored={false} />
					<DeviceOverlay
						poseFrameRef={pose.frameRef}
						markerFrameRef={marker.frameRef}
						placement={test.device}
						deviceMarkerId={DEFAULT_DEVICE_MARKER_ID}
						markerSizeCm={DEFAULT_MARKER_SIZE_CM}
					/>
					<MarkerOverlay frameRef={marker.frameRef} deviceMarkerId={DEFAULT_DEVICE_MARKER_ID} mirrored={false} />

					<div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
						<Badge className={pose.hasPerson ? "bg-green-600 text-white" : "bg-black/70 text-white"}>
							{pose.hasPerson ? "Tracking" : "No person detected"}
						</Badge>
						<Badge className={deviceBadge.badge}>{deviceBadge.label}</Badge>
					</div>
					<div className="pointer-events-none absolute top-3 left-3 rounded-lg bg-black/60 px-4 py-2 text-white">
						<span className="text-xs tracking-wider text-white/70 uppercase">Repetition</span>
						<p className="text-3xl font-bold tabular-nums">
							{reps.length} / {repetitions}
						</p>
					</div>
					{activeRep && (
						<div className="pointer-events-none absolute inset-0 rounded-xl ring-4 ring-red-500 ring-inset" />
					)}
					{phase === "loading" && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white">
							<Loader2Icon className="size-10 animate-spin" />
							<p className="text-lg font-semibold">Loading pose model…</p>
						</div>
					)}
					{phase === "error" && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center text-white">
							<TriangleAlertIcon className="size-10" />
							<p className="text-lg font-semibold">The pose model failed to load</p>
							<p className="text-sm text-white/70">Reload the page and try again.</p>
						</div>
					)}
					<div
						className={cn(
							"pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-2.5 text-base font-semibold whitespace-nowrap text-white shadow-lg",
							phase === "done" ?
								isFinished ? "bg-green-600"
								:	"bg-amber-500"
							: activeRep ? "bg-red-600"
							: "bg-black/70"
						)}
					>
						{phase === "done" ?
							<>
								<CircleCheckIcon className="size-5" />
								Analysis complete — {reps.length} of {repetitions} repetitions found
							</>
						: activeRep ?
							<>
								<span className="size-2.5 animate-pulse rounded-full bg-white" />
								Repetition {reps.length + 1} · {((videoMs - activeRep.startMs) / 1000).toFixed(1)} s ·{" "}
								{activeRep.peakKg.toFixed(1)} kg
							</>
						: isFinished ?
							<>
								<CircleCheckIcon className="size-5" />
								All {repetitions} repetitions found
							</>
						:	<>
								<HandIcon className="size-5" />
								Waiting for a push over {FORCE_REP.startKg} kg
							</>
						}
					</div>
				</div>

				<div className="flex flex-col gap-1.5">
					<Progress value={durationMs > 0 ? Math.min(100, (videoMs / durationMs) * 100) : 0} />
					<span className="text-muted-foreground text-xs tabular-nums">
						{(videoMs / 1000).toFixed(1)} s / {(durationMs / 1000).toFixed(1)} s
					</span>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Button size="lg" variant="outline" disabled={phase !== "playing" && phase !== "paused"} onClick={togglePlay}>
						{phase === "playing" ?
							<PauseIcon />
						:	<PlayIcon />}
						{phase === "playing" ? "Pause" : "Resume"}
					</Button>
					<Button size="lg" variant="outline" onClick={onRestart}>
						<RotateCcwIcon />
						Analyse again
					</Button>
					<Button
						className="ml-auto"
						size="lg"
						disabled={phase !== "done" || reps.length === 0}
						onClick={() => setIsSaving(true)}
					>
						<SaveIcon />
						Save
					</Button>
				</div>
				{phase === "done" && reps.length === 0 && (
					<p className="text-muted-foreground text-sm">No repetitions were found, so there is nothing to save.</p>
				)}

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

				<Card>
					<CardHeader>
						<CardTitle>Force (last {FORCE_GRAPH_WINDOW_SECONDS} seconds)</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
							<Stat label="Current force" value={formatKg(currentKg)} highlight />
							<Stat label="Peak (this push)" value={formatKg(activeRep?.peakKg)} />
							<Stat label="Peak (last repetition)" value={formatKg(reps[reps.length - 1]?.force?.peakKg)} />
							<Stat label="Repetition starts at" value={`${FORCE_REP.startKg} kg`} />
						</div>
						<ForceGraph
							samplesRef={replayedRef}
							windowSeconds={FORCE_GRAPH_WINDOW_SECONDS}
							thresholdKg={FORCE_REP.startKg}
							className="h-56"
						/>
					</CardContent>
				</Card>
			</div>

			{/* Right: results so far */}
			<div className="flex flex-col gap-4">
				<SessionCard
					session={shownSession}
					repetitions={repetitions}
					reps={reps.map((rep) => ({ durationMs: rep.durationMs, peakKg: rep.force?.peakKg, warnings: rep.warnings }))}
				/>
				<DevicePositionCard
					placement={test.device}
					check={deviceCheck}
					markerSidePx={markerSidePx}
					markerFailed={marker.status === "error"}
				/>
				<AngleDashboardCard metrics={liveMetrics} />
			</div>
		</div>
	);
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
	return (
		<div className="flex flex-col gap-0.5 rounded-lg border p-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className={cn("font-semibold tabular-nums", highlight ? "text-2xl" : "text-lg")}>{value}</span>
		</div>
	);
}
