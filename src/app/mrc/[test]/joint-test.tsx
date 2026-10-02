"use client";

import { cn } from "cn";
import {
	CheckIcon,
	ChevronLeft,
	ChevronRight,
	CircleCheckIcon,
	HandIcon,
	PauseIcon,
	PlayIcon,
	RotateCcwIcon,
	Undo2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { MRC_SIDE_LABEL, MRC_TESTS, MrcTest } from "@/lib/mrc/joints";
import { mrcTestHref } from "@/lib/mrc/routes";
import { createMockSession, MrcSession } from "@/lib/mrc/session";

import CameraView from "./camera-view";
import { AngleDashboardCard, FormStatusCard, RecommendationsCard, SessionCard } from "./session-cards";

export default function JointTest({
	test,
	isSequence,
	isManual,
	nextTest,
}: {
	test: MrcTest;
	isSequence: boolean;
	isManual: boolean;
	nextTest?: MrcTest;
}) {
	const { joint } = test;
	// TODO: replace the mock with live data from the pose model.
	const [session, setSession] = useState<MrcSession>(() => createMockSession(test));
	const index = MRC_TESTS.findIndex(({ id }) => id === test.id);

	// --- Manual mode (no force device): the doctor taps the screen to start/stop each repetition.
	const [repDurationsMs, setRepDurationsMs] = useState<number[]>([]);
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

	const toggleRep = () => {
		if (isFinished) return;
		const time = performance.now();
		if (repStartedAt === null) {
			setRepStartedAt(time);
			setNow(time);
		} else {
			setRepDurationsMs((prev) => [...prev, time - repStartedAt]);
			setRepStartedAt(null);
		}
	};

	const reset = () => {
		setSession(createMockSession(test));
		setRepDurationsMs([]);
		setRepStartedAt(null);
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
					{isManual && (
						<Badge variant="secondary">
							<HandIcon />
							Without force
						</Badge>
					)}
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
				{/* Left: camera + controls */}
				<div className="flex flex-col gap-4">
					<CameraView onScreenClick={isManual ? toggleRep : undefined}>
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
							<Button
								size="lg"
								variant="outline"
								disabled={repsDone === 0 || isRepActive}
								onClick={() => setRepDurationsMs((prev) => prev.slice(0, -1))}
							>
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

						{/* TODO: move on automatically once the session is finished. */}
						{isSequence && (
							<Link
								className={buttonVariants({
									size: "lg",
									variant: isManual && isFinished ? "default" : "outline",
									className: "ml-auto",
								})}
								href={nextTest ? mrcTestHref(nextTest.id, { sequence: true, manual: isManual }) : "/mrc"}
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
					<AngleDashboardCard metrics={session.metrics} />
					<FormStatusCard form={session.form} />
					<RecommendationsCard recommendations={session.recommendations} />
				</div>
			</div>
		</div>
	);
}
