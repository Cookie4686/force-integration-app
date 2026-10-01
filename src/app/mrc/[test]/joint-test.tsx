"use client";

import { cn } from "cn";
import { CheckIcon, ChevronLeft, ChevronRight, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { MRC_JOINTS, MrcJoint } from "@/lib/mrc/joints";
import { createMockSession, MrcSession } from "@/lib/mrc/session";

import CameraView from "./camera-view";
import { AngleDashboardCard, FormStatusCard, RecommendationsCard, SessionCard } from "./session-cards";

export default function JointTest({
	joint,
	isSequence,
	nextJoint,
}: {
	joint: MrcJoint;
	isSequence: boolean;
	nextJoint?: MrcJoint;
}) {
	// TODO: replace the mock with live data from the pose model.
	const [session, setSession] = useState<MrcSession>(() => createMockSession(joint));
	const index = MRC_JOINTS.findIndex(({ id }) => id === joint.id);

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
							Test {index + 1} of {MRC_JOINTS.length}
						</span>
						<div className="flex gap-1">
							{MRC_JOINTS.map(({ id }, idx) => (
								<div
									className={cn(
										"h-1.5 w-6 rounded-full",
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
				<div className="flex items-center gap-3">
					<h2 className="text-3xl font-bold">{joint.name} Test</h2>
					<Badge variant="outline">{joint.region}</Badge>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
				{/* Left: camera + controls */}
				<div className="flex flex-col gap-4">
					<CameraView>
						<div className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-4 py-2 text-white">
							<span className="text-xs tracking-wider text-white/70 uppercase">Repetition</span>
							<p className="text-3xl font-bold tabular-nums">
								{session.repetitionsDone} / {joint.repetitions}
							</p>
						</div>
					</CameraView>

					<div className="flex flex-wrap items-center gap-2">
						{session.status === "running" ?
							<Button size="lg" variant="secondary" onClick={() => setStatus("paused")}>
								<PauseIcon />
								Pause
							</Button>
						:	<Button size="lg" onClick={() => setStatus("running")}>
								<PlayIcon />
								{session.status === "paused" ? "Resume" : "Start"}
							</Button>
						}
						<Button size="lg" variant="outline" onClick={() => setSession(createMockSession(joint))}>
							<RotateCcwIcon />
							Reset
						</Button>

						{/* TODO: move on automatically once the session is finished. */}
						{isSequence && (
							<Link
								className={buttonVariants({ size: "lg", variant: "outline", className: "ml-auto" })}
								href={nextJoint ? `/mrc/${nextJoint.id}?mode=sequence` : "/mrc"}
							>
								{nextJoint ?
									<>
										<span>Next: {nextJoint.name}</span>
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
					<SessionCard session={session} repetitions={joint.repetitions} />
					<AngleDashboardCard metrics={session.metrics} />
					<FormStatusCard form={session.form} />
					<RecommendationsCard recommendations={session.recommendations} />
				</div>
			</div>
		</div>
	);
}
