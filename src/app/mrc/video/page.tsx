"use client";

import { cn } from "cn";
import {
	ChevronLeft,
	CircleCheckIcon,
	CircleIcon,
	DownloadIcon,
	FileJsonIcon,
	FileVideoIcon,
	PlayIcon,
	SparklesIcon,
	TriangleAlertIcon,
	UploadIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { HhdSample } from "@/lib/hhd/protocol";

import ForceGraph from "@/components/force/force-graph";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ForceRecording, forceRecordingToJson, parseForceRecording, simulateForceRecording } from "@/lib/hhd/recording";
import { FORCE_REP } from "@/lib/mrc/force";
import {
	getMrcTest,
	MAX_REPETITIONS,
	MIN_REPETITIONS,
	MRC_SIDE_LABEL,
	MRC_TESTS,
	parseRepetitions,
} from "@/lib/mrc/joints";

import VideoAnalysis from "./video-analysis";

type VideoInfo = { durationS: number; width: number; height: number };

// Where the force data came from: a JSON file, or generated for a demo.
type ForceSource = { name: string; sizeBytes: number | null; simulated: boolean };

// Video and force recordings longer apart than this probably do not belong together.
const LENGTH_MISMATCH_S = 2;

const formatSeconds = (seconds: number) =>
	seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${seconds.toFixed(1)} s`;

const formatSize = (bytes: number) =>
	bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const downloadText = (text: string, fileName: string) => {
	const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.click();
	URL.revokeObjectURL(url);
};

// MRC test from a recorded video plus the force recording made at the same time.
export default function PageMRCVideo() {
	// --- 1. Video
	const [videoFile, setVideoFile] = useState<File | null>(null);
	const [videoUrl, setVideoUrl] = useState<string | null>(null);
	const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
	const [videoError, setVideoError] = useState<string | null>(null);

	const chooseVideo = (file: File | null) => {
		setVideoInfo(null);
		setVideoError(null);
		setVideoFile(file);
		setVideoUrl(file ? URL.createObjectURL(file) : null);
	};
	// Free the previous video's memory when it is replaced or the page closes.
	useEffect(() => {
		if (videoUrl === null) return;
		return () => URL.revokeObjectURL(videoUrl);
	}, [videoUrl]);

	// --- 2. Force (JSON or simulated)
	const [forceSource, setForceSource] = useState<ForceSource | null>(null);
	const [force, setForce] = useState<ForceRecording | null>(null);
	const [forceError, setForceError] = useState<string | null>(null);
	const forceSamplesRef = useRef<HhdSample[]>([]);
	// Only the most recently chosen file may set the result.
	const forceReadRef = useRef(0);

	const setRecording = (recording: ForceRecording | null) => {
		forceSamplesRef.current = recording?.samples ?? [];
		setForce(recording);
	};

	const chooseForce = (file: File | null) => {
		setForceSource(file && { name: file.name, sizeBytes: file.size, simulated: false });
		setRecording(null);
		setForceError(null);
		const read = ++forceReadRef.current;
		if (!file) return;
		file.text().then(
			(text) => {
				if (read !== forceReadRef.current) return;
				try {
					setRecording(parseForceRecording(text));
				} catch (error) {
					setForceError(error instanceof Error ? error.message : "Could not read the file.");
				}
			},
			() => {
				if (read === forceReadRef.current) setForceError("Could not read the file.");
			}
		);
	};

	// --- 3. Test
	const [testId, setTestId] = useState(MRC_TESTS[0].id);
	const test = getMrcTest(testId) ?? MRC_TESTS[0];
	// Empty = the joint's default repetitions.
	const [repetitionsText, setRepetitionsText] = useState("");
	const customRepetitions = parseRepetitions(repetitionsText);
	const isRepetitionsValid = repetitionsText.trim() === "" || customRepetitions !== undefined;
	const repetitions = customRepetitions ?? test.joint.repetitions;

	// Demo: force data as long as the video, with one push per repetition of the chosen test.
	const simulateForce = () => {
		if (!videoInfo) return;
		++forceReadRef.current;
		setForceError(null);
		setForceSource({ name: "Simulated force data", sizeBytes: null, simulated: true });
		setRecording(simulateForceRecording(videoInfo.durationS * 1000, repetitions));
	};

	const isVideoReady = videoInfo !== null;
	const isForceReady = force !== null;
	const lengthGapS = videoInfo && force ? Math.abs(videoInfo.durationS - force.durationMs / 1000) : 0;

	// --- Analysis: a new key restarts it from the beginning.
	const [analysisKey, setAnalysisKey] = useState<number | null>(null);

	if (analysisKey !== null && videoFile && videoUrl && force) {
		return (
			<div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<Button variant="outline" onClick={() => setAnalysisKey(null)}>
						<ChevronLeft size={16} />
						Back to files
					</Button>
					<span className="text-muted-foreground text-sm">
						{videoFile.name} · {forceSource?.name}
					</span>
				</div>
				<div className="flex flex-col gap-1">
					<span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Video analysis</span>
					<h2 className="text-3xl font-bold">
						{MRC_SIDE_LABEL[test.side]} {test.joint.name} Test
					</h2>
				</div>
				<VideoAnalysis
					key={analysisKey}
					test={test}
					videoUrl={videoUrl}
					videoName={videoFile.name}
					recording={force}
					repetitions={repetitions}
					customRepetitions={customRepetitions}
					onRestart={() => setAnalysisKey((key) => (key ?? 0) + 1)}
				/>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
			<div className="flex flex-col gap-1">
				<span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">MRC Test</span>
				<h2 className="text-3xl font-bold">Video</h2>
				<p className="text-muted-foreground text-sm">
					Run the test from a recorded video and the force recording made at the same time. Both are required.
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				{/* 1. Video */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<StepNumber done={isVideoReady}>1</StepNumber>
							Video
						</CardTitle>
						<CardDescription>Recording of the patient during the test (MP4, WebM, …).</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{videoFile && videoUrl ?
							<>
								<video
									className="aspect-video w-full rounded-lg bg-black object-contain"
									src={videoUrl}
									controls
									playsInline
									onLoadedMetadata={(event) => {
										const video = event.currentTarget;
										setVideoInfo({ durationS: video.duration, width: video.videoWidth, height: video.videoHeight });
									}}
									onError={() =>
										setVideoError("This video format cannot be played in the browser. Try MP4 (H.264) or WebM.")
									}
								/>
								<SelectedFile
									icon={FileVideoIcon}
									name={videoFile.name}
									details={[
										formatSize(videoFile.size),
										videoInfo && formatSeconds(videoInfo.durationS),
										videoInfo && `${videoInfo.width} × ${videoInfo.height}`,
									]}
									onRemove={() => chooseVideo(null)}
								/>
							</>
						:	<FileDrop
								icon={FileVideoIcon}
								accept="video/*"
								label="Choose a video file"
								hint="or drop it here"
								onFile={chooseVideo}
							/>
						}
						{videoError && <ErrorText>{videoError}</ErrorText>}
					</CardContent>
				</Card>

				{/* 2. Force */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<StepNumber done={isForceReady}>2</StepNumber>
							Force (JSON)
						</CardTitle>
						<CardDescription>
							Force samples recorded with the video: time in ms (<code>timestampMs</code>) and force in kg (
							<code>forceKg</code>).
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{forceSource ?
							<>
								{force && (
									<ForceGraph
										samplesRef={forceSamplesRef}
										windowSeconds={force.durationMs / 1000}
										thresholdKg={FORCE_REP.startKg}
										fromStart
										className="aspect-video h-auto rounded-lg border"
									/>
								)}
								<SelectedFile
									icon={forceSource.simulated ? SparklesIcon : FileJsonIcon}
									name={forceSource.name}
									details={[
										forceSource.sizeBytes !== null && formatSize(forceSource.sizeBytes),
										force && formatSeconds(force.durationMs / 1000),
										force && `${force.samples.length.toLocaleString()} samples (${Math.round(force.sampleRateHz)} Hz)`,
										force && `peak ${force.peakKg.toFixed(1)} kg`,
									]}
									onRemove={() => chooseForce(null)}
								/>
								{force && (
									<Button
										className="self-start"
										size="sm"
										variant="outline"
										onClick={() => downloadText(forceRecordingToJson(force), "force-recording.json")}
									>
										<DownloadIcon />
										Download as JSON
									</Button>
								)}
							</>
						:	<>
								<FileDrop
									icon={FileJsonIcon}
									accept="application/json,.json"
									label="Choose a force file (.json)"
									hint="or drop it here"
									onFile={chooseForce}
								/>
								<div className="flex items-center gap-3">
									<Button variant="secondary" disabled={!isVideoReady} onClick={simulateForce}>
										<SparklesIcon />
										Use simulated force data
									</Button>
									<span className="text-muted-foreground text-xs">
										{isVideoReady ?
											`Demo: ${repetitions} pushes spread over the video.`
										:	"Load the video first — the simulated data matches its length."}
									</span>
								</div>
							</>
						}
						{forceError && <ErrorText>{forceError}</ErrorText>}
					</CardContent>
				</Card>
			</div>

			{/* 3. Test + start */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<StepNumber done={isVideoReady && isForceReady}>3</StepNumber>
						Test
					</CardTitle>
					<CardDescription>
						Which test the video shows. Its posture checks and device position are used.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="video-test">Test</Label>
						<NativeSelect id="video-test" value={testId} onChange={(event) => setTestId(event.target.value)}>
							{MRC_TESTS.map((item) => (
								<NativeSelectOption key={item.id} value={item.id}>
									{MRC_SIDE_LABEL[item.side]} {item.joint.name} (default {item.joint.repetitions} repetitions)
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="video-repetitions">
							Repetitions <span className="text-muted-foreground font-normal">(optional)</span>
						</Label>
						<Input
							className="w-48"
							id="video-repetitions"
							type="number"
							inputMode="numeric"
							min={MIN_REPETITIONS}
							max={MAX_REPETITIONS}
							step={1}
							value={repetitionsText}
							placeholder={`Default: ${test.joint.repetitions}`}
							aria-invalid={!isRepetitionsValid}
							onChange={(event) => setRepetitionsText(event.target.value)}
						/>
						<p
							className={cn("text-xs", isRepetitionsValid ? "text-muted-foreground" : "text-red-600 dark:text-red-400")}
						>
							{isRepetitionsValid ?
								"Leave empty to use the default."
							:	`Enter a whole number from ${MIN_REPETITIONS} to ${MAX_REPETITIONS}.`}
						</p>
					</div>
					<ul className="flex flex-col gap-1.5 text-sm">
						<Requirement done={isVideoReady}>Video loaded</Requirement>
						<Requirement done={isForceReady}>Force data loaded</Requirement>
					</ul>
					{lengthGapS > LENGTH_MISMATCH_S && (
						<p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
							<TriangleAlertIcon className="size-4 shrink-0" />
							The video and the force recording differ in length by {formatSeconds(lengthGapS)}. Check that they were
							recorded at the same time.
						</p>
					)}
					<Button
						className="self-start"
						size="lg"
						disabled={!isVideoReady || !isForceReady || !isRepetitionsValid}
						onClick={() => setAnalysisKey(0)}
					>
						<PlayIcon />
						Start analysis
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}

function StepNumber({ done, children }: { done: boolean; children: React.ReactNode }) {
	return (
		<span
			className={cn(
				"flex size-6 items-center justify-center rounded-full text-xs font-bold",
				done ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"
			)}
		>
			{done ?
				<CircleCheckIcon className="size-4" />
			:	children}
		</span>
	);
}

// Click to choose, or drag a file onto it.
function FileDrop({
	icon: Icon,
	accept,
	label,
	hint,
	onFile,
}: {
	icon: typeof FileVideoIcon;
	accept: string;
	label: string;
	hint: string;
	onFile: (file: File) => void;
}) {
	const [isOver, setIsOver] = useState(false);
	return (
		<label
			className={cn(
				"hover:bg-muted/50 flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
				isOver && "border-primary bg-primary/5"
			)}
			onDragOver={(event) => {
				event.preventDefault();
				setIsOver(true);
			}}
			onDragLeave={() => setIsOver(false)}
			onDrop={(event) => {
				event.preventDefault();
				setIsOver(false);
				const file = event.dataTransfer.files[0];
				if (file) onFile(file);
			}}
		>
			<Icon className="text-muted-foreground size-10" />
			<span className="flex items-center gap-1.5 font-medium">
				<UploadIcon className="size-4" />
				{label}
			</span>
			<span className="text-muted-foreground text-xs">{hint}</span>
			<input
				className="sr-only"
				type="file"
				accept={accept}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) onFile(file);
					event.target.value = "";
				}}
			/>
		</label>
	);
}

function SelectedFile({
	icon: Icon,
	name,
	details,
	onRemove,
}: {
	icon: typeof FileVideoIcon;
	name: string;
	details: (string | null | false)[];
	onRemove: () => void;
}) {
	return (
		<div className="flex items-center gap-3 rounded-lg border px-3 py-2">
			<Icon className="text-muted-foreground size-5 shrink-0" />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-medium">{name}</span>
				<span className="text-muted-foreground text-xs">{details.filter(Boolean).join(" · ")}</span>
			</div>
			<Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={onRemove}>
				<XIcon />
			</Button>
		</div>
	);
}

function Requirement({ done, children }: { done: boolean; children: React.ReactNode }) {
	return (
		<li className={cn("flex items-center gap-2", done ? "text-foreground" : "text-muted-foreground")}>
			{done ?
				<CircleCheckIcon className="size-4 text-green-600 dark:text-green-400" />
			:	<CircleIcon className="size-4" />}
			{children}
		</li>
	);
}

function ErrorText({ children }: { children: React.ReactNode }) {
	return (
		<p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
			<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
			{children}
		</p>
	);
}
