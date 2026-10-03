"use client";

import { cn } from "cn";
import { ChevronRight, HandIcon, ListOrderedIcon, PlayIcon, WeightIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MRC_JOINTS, MRC_SIDE_LABEL, MRC_TESTS } from "@/lib/mrc/joints";

import StartTestDialog, { StartRequest } from "./start-test-dialog";

// TODO: แก้ให้เป็นของจริงด้วย
const PREPARATION_STEPS = [
	"Place the camera so the patient's whole body is in view.",
	"Use a bright room with a plain background.",
	"Make sure only the patient is near the centre of the frame.",
	"Allow camera access when the browser asks.",
];

const TEST_MODES = [
	{
		manual: false,
		icon: WeightIcon,
		title: "With force device",
		description: "Repetitions follow the Bluetooth force reading.",
		note: "In development",
	},
	{
		manual: true,
		icon: HandIcon,
		title: "Without force",
		description: "The doctor taps the camera screen to start and stop each repetition.",
		note: null,
	},
];

export default function PageMRC() {
	// No force device available yet, so manual mode is the default.
	const [manual, setManual] = useState(true);
	// The test the user clicked "Start" on; opens the popup asking for test name + patient.
	const [startRequest, setStartRequest] = useState<StartRequest | null>(null);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-12">
			{/* Header */}
			<div className="text-center">
				<h2 className="mb-2 text-3xl font-bold">6 Exercise Test</h2>
				<p className="text-muted-foreground text-sm">Run the full test, or pick a single joint</p>
			</div>

			{startRequest && <StartTestDialog request={startRequest} manual={manual} onClose={() => setStartRequest(null)} />}

			{/* Preparation checklist */}
			<Card>
				<CardHeader>
					<CardTitle>Before you start</CardTitle>
				</CardHeader>
				<CardContent>
					<ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
						{PREPARATION_STEPS.map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
				</CardContent>
			</Card>

			{/* Test mode: with or without the force device */}
			<section className="flex flex-col gap-4">
				<SectionTitle title="Test Mode" description="Choose how repetitions are started and stopped." />
				<div className="grid grid-cols-2 gap-4 max-md:grid-cols-1" role="radiogroup">
					{TEST_MODES.map((mode) => {
						const selected = manual === mode.manual;
						return (
							<button
								className={cn(
									"flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors",
									selected ? "border-primary bg-primary/5" : (
										"hover:bg-muted ring-foreground/10 border-transparent ring-1"
									)
								)}
								key={mode.title}
								role="radio"
								aria-checked={selected}
								onClick={() => setManual(mode.manual)}
							>
								<div
									className={cn(
										"flex size-10 shrink-0 items-center justify-center rounded-md border",
										selected && "bg-primary text-primary-foreground border-primary"
									)}
								>
									<mode.icon size={20} />
								</div>
								<div className="flex flex-col gap-1">
									<span className="flex items-center gap-2 font-semibold">
										{mode.title}
										{mode.note && (
											<span className="text-muted-foreground rounded-full border px-2 text-xs font-normal">
												{mode.note}
											</span>
										)}
									</span>
									<span className="text-muted-foreground text-sm">{mode.description}</span>
								</div>
							</button>
						);
					})}
				</div>
			</section>

			<Separator />

			{/* Section 1: full test (all joints in sequence) */}
			<section className="flex flex-col gap-4">
				<SectionTitle
					title="Full Test"
					description={`Runs all ${MRC_TESTS.length} tests in order — each joint on the right side, then the left. Each test moves on to the next automatically.`}
				/>
				<Card className="border-primary/40 bg-primary/5">
					<CardContent className="flex items-center justify-between gap-6 max-md:flex-col max-md:items-start">
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-2 font-semibold">
								<ListOrderedIcon size={18} />
								<span>Test sequence</span>
							</div>
							<div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
								{MRC_JOINTS.map((joint, idx) => (
									<Fragment key={joint.id}>
										{idx > 0 && <ChevronRight size={14} />}
										<span className="bg-background rounded-md border px-2 py-0.5">
											{idx + 1}. {joint.name}{" "}
											<span className="text-xs">({joint.sides.map((side) => MRC_SIDE_LABEL[side][0]).join(", ")})</span>
										</span>
									</Fragment>
								))}
							</div>
						</div>
						<Button
							className="h-11 px-6 text-base"
							size="lg"
							onClick={() => setStartRequest({ testId: MRC_TESTS[0].id, sequence: true, title: "Full test" })}
						>
							<PlayIcon />
							<span>Start all tests</span>
						</Button>
					</CardContent>
				</Card>
			</section>

			<Separator />

			{/* Section 2: individual tests */}
			<section className="flex flex-col gap-4">
				<SectionTitle title="Individual Test" description="Run a single joint test on one side." />
				<div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
					{MRC_JOINTS.map((joint, idx) => (
						<Card className="py-6" key={joint.id}>
							<CardHeader className="space-y-2">
								<div className="flex h-12 w-12 items-center justify-center rounded-md border text-lg font-semibold">
									{idx + 1}
								</div>
								<CardTitle className="text-lg">{joint.name}</CardTitle>
								<p className="text-muted-foreground text-xs">{joint.region}</p>
							</CardHeader>
							<CardContent className="h-full">
								<p className="text-muted-foreground text-sm">{joint.description}</p>
							</CardContent>
							<CardFooter className="gap-2">
								{joint.sides.map((side) => {
									const testId = `${joint.id}-${side}`;
									return (
										<Button
											className="flex-1 border-blue-500 dark:border-blue-400"
											size="lg"
											variant="outline"
											key={side}
											onClick={() =>
												setStartRequest({
													testId,
													sequence: false,
													title: `${MRC_SIDE_LABEL[side]} ${joint.name}`,
												})
											}
										>
											<span>{MRC_SIDE_LABEL[side]}</span>
											<ChevronRight size={16} />
										</Button>
									);
								})}
							</CardFooter>
						</Card>
					))}
				</div>
			</section>
		</div>
	);
}

function SectionTitle({ title, description }: { title: string; description: string }) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-xl font-bold">{title}</h3>
			<p className="text-muted-foreground text-sm">{description}</p>
		</div>
	);
}
