import { cn } from "cn";
import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
	getMetricLevel,
	METRIC_UNIT,
	MrcMetric,
	MrcSession,
	MrcSessionStatus,
	MrcStatusLevel,
} from "@/lib/mrc/session";

const LEVEL_STYLE: Record<
	MrcStatusLevel,
	{ label: string; text: string; marker: string; icon: typeof CircleCheckIcon }
> = {
	good: { label: "Good", text: "text-green-600 dark:text-green-400", marker: "bg-green-600", icon: CircleCheckIcon },
	warning: {
		label: "Adjust",
		text: "text-amber-600 dark:text-amber-400",
		marker: "bg-amber-500",
		icon: TriangleAlertIcon,
	},
	bad: { label: "Incorrect", text: "text-red-600 dark:text-red-400", marker: "bg-red-600", icon: CircleXIcon },
	unknown: {
		label: "Not detected",
		text: "text-muted-foreground",
		marker: "bg-muted-foreground",
		icon: CircleHelpIcon,
	},
};

const SESSION_STATUS_LABEL: Record<MrcSessionStatus, string> = {
	ready: "Ready",
	running: "In progress",
	paused: "Paused",
	finished: "Finished",
};

const formatMetric = (kind: MrcMetric["kind"], value: number) =>
	(kind === "angle" ? Math.round(value).toString() : value.toFixed(1)) + METRIC_UNIT[kind];

// --- Session -----------------------------------------------------------------

export function SessionCard({
	session,
	repetitions,
	repDurationsMs,
}: {
	session: MrcSession;
	repetitions: number;
	// Duration of each completed repetition, when known (manual mode).
	repDurationsMs?: number[];
}) {
	return (
		<Card>
			<CardHeader className="flex items-center justify-between">
				<CardTitle>Session</CardTitle>
				<Badge variant={session.status === "running" ? "default" : "outline"}>
					{SESSION_STATUS_LABEL[session.status]}
				</Badge>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<div className="flex items-baseline justify-between">
						<span className="text-sm font-medium">Repetitions</span>
						<span className="text-3xl font-bold tabular-nums">
							{session.repetitionsDone}
							<span className="text-muted-foreground text-lg font-medium"> / {repetitions}</span>
						</span>
					</div>
					<div className="flex gap-1">
						{Array.from({ length: repetitions }, (_, idx) => (
							<div
								className={cn("h-2 flex-1 rounded-full", idx < session.repetitionsDone ? "bg-primary" : "bg-muted")}
								key={idx}
							/>
						))}
					</div>
				</div>
				<Progress value={Math.round(session.progress * 100)}>
					<ProgressLabel>Session timeline</ProgressLabel>
					<ProgressValue />
				</Progress>
				{repDurationsMs && repDurationsMs.length > 0 && (
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">Repetition time</span>
						<div className="flex flex-wrap gap-1.5">
							{repDurationsMs.map((durationMs, idx) => (
								<span className="rounded-md border px-2 py-0.5 text-xs tabular-nums" key={idx}>
									#{idx + 1} · {(durationMs / 1000).toFixed(1)} s
								</span>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// --- Angle dashboard -----------------------------------------------------------

export function AngleDashboardCard({ metrics }: { metrics: MrcMetric[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Angle Dashboard</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{metrics.length === 0 ?
					<p className="text-muted-foreground text-sm">No measurements for this test.</p>
				:	metrics.map((metric) => <MetricRow key={metric.id} metric={metric} />)}
			</CardContent>
		</Card>
	);
}

function MetricRow({ metric }: { metric: MrcMetric }) {
	const { kind, label, value, target, tolerance } = metric;
	const style = LEVEL_STYLE[getMetricLevel(metric)];
	const deviation = value === null ? null : value - target;

	return (
		<div className="flex flex-col gap-2 rounded-lg border p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col">
					<span className="text-sm font-medium">{label}</span>
					<span className="text-muted-foreground text-xs">
						Target {formatMetric(kind, target)} · Tolerance ±{formatMetric(kind, tolerance)}
					</span>
				</div>
				<span className={cn("text-2xl font-bold tabular-nums", style.text)}>
					{value === null ? "—" : formatMetric(kind, value)}
				</span>
			</div>
			<RangeBar metric={metric} markerClassName={style.marker} />
			<div className="flex justify-between text-xs">
				<span className="text-muted-foreground tabular-nums">
					Deviation {deviation === null ? "—" : (deviation > 0 ? "+" : "") + formatMetric(kind, deviation)}
				</span>
				<span className={cn("font-medium", style.text)}>{style.label}</span>
			</div>
		</div>
	);
}

// Track spans target ± 3× tolerance; the shaded middle third is the correct zone.
function RangeBar({ metric, markerClassName }: { metric: MrcMetric; markerClassName: string }) {
	const { value, target, tolerance } = metric;
	const span = tolerance * 3;
	const position = value === null ? null : Math.min(1, Math.max(0, (value - (target - span)) / (span * 2)));

	return (
		<div className="bg-muted relative h-2 rounded-full">
			<div className="absolute inset-y-0 left-1/3 w-1/3 rounded-full bg-green-500/30" />
			<div className="bg-foreground/40 absolute inset-y-0 left-1/2 w-px" />
			{position !== null && (
				<div
					className={cn(
						"border-background absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2",
						markerClassName
					)}
					style={{ left: `${position * 100}%` }}
				/>
			)}
		</div>
	);
}

// --- Form alignment ------------------------------------------------------------

export function FormStatusCard({ form }: { form: MrcSession["form"] }) {
	const style = LEVEL_STYLE[form.level];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Form Alignment Status</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className={cn("flex items-center gap-2 font-semibold", style.text)}>
					<style.icon className="size-5" />
					<span>{form.message}</span>
				</div>
				<ul className="flex flex-col gap-1.5 text-sm">
					{form.checks.map((check) => (
						<li className="flex items-center gap-2" key={check.label}>
							{check.ok ?
								<CircleCheckIcon className="size-4 text-green-600 dark:text-green-400" />
							:	<CircleXIcon className="size-4 text-red-600 dark:text-red-400" />}
							<span className={cn(!check.ok && "font-medium")}>{check.label}</span>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

// --- Recommendations -------------------------------------------------------------

export function RecommendationsCard({ recommendations }: { recommendations: string[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Recommendations</CardTitle>
			</CardHeader>
			<CardContent>
				{recommendations.length === 0 ?
					<p className="text-muted-foreground text-sm">Looking good — keep going.</p>
				:	<ul className="flex flex-col gap-2 text-sm">
						{recommendations.map((text) => (
							<li className="flex gap-2" key={text}>
								<LightbulbIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
								<span>{text}</span>
							</li>
						))}
					</ul>
				}
			</CardContent>
		</Card>
	);
}
