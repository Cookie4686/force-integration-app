import { cn } from "cn";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import type { MeasureSnapshot, RepMetric, TestResult } from "@/lib/storage/types";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMrcTest, MRC_SIDE_LABEL, MRC_TESTS } from "@/lib/mrc/joints";
import { getMetricLevel, METRIC_UNIT, MrcStatusLevel } from "@/lib/mrc/session";
import { defaultExportName } from "@/lib/storage/export-name";
import { isValidId, readPatients, readSession } from "@/lib/storage/files";

import ExportButtons from "./export-buttons";

const LEVEL_TEXT: Record<MrcStatusLevel, string> = {
	good: "text-green-600 dark:text-green-400",
	warning: "text-amber-600 dark:text-amber-400",
	bad: "text-red-600 dark:text-red-400",
	unknown: "text-muted-foreground",
};

const formatValue = (measure: MeasureSnapshot, value: number | null) =>
	value === null ? "—" : (
		`${measure.kind === "alignment" ? value.toFixed(1) : Math.round(value)}${METRIC_UNIT[measure.kind]}`
	);

const formatDateTime = (iso: string) =>
	new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Results of one saved session (data/sessions/<id>.json).
export default async function PageMRCSession({ params }: PageProps<"/mrc/session/[sessionId]">) {
	// Always read the file fresh — results change while a test is running.
	await connection();

	const { sessionId } = await params;
	if (!isValidId(sessionId)) notFound();
	const session = await readSession(sessionId);
	// A session gets a file only once a repetition is saved.
	if (!session) {
		return (
			<div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-4 px-8 py-10">
				<h2 className="text-2xl font-bold">Nothing was saved</h2>
				<p className="text-muted-foreground text-sm">
					No repetition was recorded in this test session, so no results were saved.
				</p>
				<Link className={buttonVariants({ variant: "outline" })} href="/mrc">
					<ChevronLeft size={16} />
					Back to MRC
				</Link>
			</div>
		);
	}
	const patient = (await readPatients()).find((item) => item.id === session.patientId) ?? null;

	// Show tests in the standard test order.
	const order = (test: TestResult) => MRC_TESTS.findIndex(({ id }) => id === test.testId);
	const tests = [...session.tests].sort((a, b) => order(a) - order(b));

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-10">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link className={buttonVariants({ variant: "outline" })} href="/mrc">
					<ChevronLeft size={16} />
					Back to MRC
				</Link>
				<ExportButtons sessionId={session.id} defaultName={defaultExportName(session, patient)} />
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Results</span>
				<h2 className="text-3xl font-bold">{session.name || "Untitled test"}</h2>
				<p className="text-muted-foreground text-sm">
					<span className="text-foreground font-medium">{patient ? patient.name : "Unknown patient"}</span>
					{patient?.hn && <> · HN {patient.hn}</>} ·{formatDateTime(session.startedAt)} ·{" "}
					{session.mode === "manual" ? "Without force" : "With force device"}
					{session.sequence && " · Full test"}
				</p>
			</div>

			{tests.length === 0 && <p className="text-muted-foreground text-sm">No tests were recorded in this session.</p>}

			{tests.map((test) => {
				const config = getMrcTest(test.testId);
				const title = config ? `${MRC_SIDE_LABEL[config.side]} ${config.joint.name}` : test.testId;
				return (
					<Card key={test.testId}>
						<CardHeader className="flex flex-wrap items-center justify-between gap-2">
							<CardTitle>{title}</CardTitle>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground text-sm">
									{test.reps.length}
									{config && ` / ${config.joint.repetitions}`} repetitions
								</span>
								<Badge className={test.status === "completed" ? "bg-green-600 text-white" : "bg-amber-500 text-white"}>
									{test.status === "completed" ? "Completed" : "Incomplete"}
								</Badge>
							</div>
						</CardHeader>
						<CardContent>
							{test.reps.length === 0 ?
								<p className="text-muted-foreground text-sm">No repetitions recorded.</p>
							:	<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Rep</TableHead>
											<TableHead>Duration</TableHead>
											{test.measures.map((measure) => (
												<TableHead key={measure.label}>
													<div className="flex flex-col">
														<span>{measure.label}</span>
														<span className="text-muted-foreground text-xs font-normal">
															Target {formatValue(measure, measure.target)} ± {formatValue(measure, measure.tolerance)}
														</span>
													</div>
												</TableHead>
											))}
										</TableRow>
									</TableHeader>
									<TableBody>
										{test.reps.map((rep) => (
											<TableRow key={rep.index}>
												<TableCell className="font-medium">#{rep.index}</TableCell>
												<TableCell className="tabular-nums">{(rep.durationMs / 1000).toFixed(1)} s</TableCell>
												{test.measures.map((measure, m) => (
													<TableCell key={measure.label}>
														<MetricCell measure={measure} metric={rep.metrics[m]} />
													</TableCell>
												))}
											</TableRow>
										))}
									</TableBody>
								</Table>
							}
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}

// Average (coloured by status), range and share of time within tolerance.
function MetricCell({ measure, metric }: { measure: MeasureSnapshot; metric: RepMetric | undefined }) {
	if (!metric || metric.mean === null) return <span className="text-muted-foreground">Not measured</span>;
	const level = getMetricLevel({ value: metric.mean, target: measure.target, tolerance: measure.tolerance });
	return (
		<div className="flex flex-col tabular-nums">
			<span className={cn("font-semibold", LEVEL_TEXT[level])}>{formatValue(measure, metric.mean)} avg</span>
			<span className="text-muted-foreground text-xs">
				{formatValue(measure, metric.min)} – {formatValue(measure, metric.max)} ·{" "}
				{Math.round(metric.inTolerancePct ?? 0)}% in tolerance
			</span>
		</div>
	);
}
