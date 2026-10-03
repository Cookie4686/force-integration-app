// Live state of one test (a joint on one side), as shown on /mrc/[test].
//
// This is the contract between the test UI and the pose model: the UI only
// renders an `MrcSession`, and the model integration is responsible for
// producing one every frame. Static per-joint configuration (which landmarks,
// target angles, …) lives in joints.ts; this file holds what changes at runtime.

import { getMeasureLabel, MrcMeasure, MrcTest } from "./joints";

export type MrcSessionStatus = "ready" | "running" | "paused" | "finished";

export type MrcStatusLevel = "good" | "warning" | "bad" | "unknown";

// Live reading of one of the joint's `measures` (same order). `angle` is in
// degrees, `alignment` in centimetres. `value` is null when the model cannot
// measure it this frame (e.g. landmark not visible).
export type MrcMetric = {
	id: string;
	kind: "angle" | "alignment";
	label: string;
	value: number | null;
	target: number;
	// Allowed deviation from target that still counts as correct posture.
	tolerance: number;
};

export type MrcFormCheck = { label: string; ok: boolean };

export type MrcSession = {
	status: MrcSessionStatus;
	repetitionsDone: number;
	// 0..1 share of the session completed.
	progress: number;
	metrics: MrcMetric[];
	form: { level: MrcStatusLevel; message: string; checks: MrcFormCheck[] };
	recommendations: string[];
};

export const METRIC_UNIT: Record<MrcMetric["kind"], string> = { angle: "°", alignment: " cm" };

// good: within tolerance · warning: within 2× tolerance · bad: beyond that.
export const getMetricLevel = ({
	value,
	target,
	tolerance,
}: Pick<MrcMetric, "value" | "target" | "tolerance">): MrcStatusLevel => {
	if (value === null) return "unknown";
	const offset = Math.abs(value - target);
	return (
		offset <= tolerance ? "good"
		: offset <= tolerance * 2 ? "warning"
		: "bad"
	);
};

// Dashboard rows for a test's measures, given their live values (same order; null = not measured).
export const buildMetrics = (measures: MrcMeasure[], values: (number | null)[]): MrcMetric[] =>
	measures.map((measure, idx) => ({
		id: String(idx),
		kind: measure.kind,
		label: getMeasureLabel(measure),
		value: values[idx] ?? null,
		target: measure.target,
		tolerance: measure.tolerance,
	}));

// MOCK: placeholder values so the layout can be reviewed before the model is
// connected. Replace with real data from the model integration.
export const createMockSession = ({ joint, measures }: MrcTest): MrcSession => ({
	status: "ready",
	repetitionsDone: 2,
	progress: 0.4,
	// Live values come from the pose model (see lib/mrc/measure.ts).
	metrics: buildMetrics(measures, []),
	form: {
		level: "warning",
		message: "Minor adjustment needed",
		checks: [
			{ label: "Whole body in view", ok: true },
			{ label: "Facing the camera", ok: true },
			{ label: "Shoulders level", ok: false },
			{ label: "Back straight", ok: true },
		],
	},
	recommendations: [
		"Lean your trunk less — keep your back upright.",
		`Move your ${joint.name.toLowerCase()} slowly through the full range.`,
		"Keep both shoulders at the same height.",
	],
});
