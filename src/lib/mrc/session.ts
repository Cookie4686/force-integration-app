// Live state of one joint test, as shown on /mrc/[joint].
//
// This is the contract between the test UI and the pose model: the UI only
// renders an `MrcSession`, and the model integration is responsible for
// producing one every frame. Static per-joint configuration (which landmarks,
// target angles, …) lives in joints.ts; this file holds what changes at runtime.

import { MrcJoint } from "./joints";

export type MrcSessionStatus = "ready" | "running" | "paused" | "finished";

export type MrcStatusLevel = "good" | "warning" | "bad" | "unknown";

// A measured quantity compared against a target. `angle` is in degrees,
// `alignment` is a distance in centimetres. `value` is null when the model
// cannot measure it this frame (e.g. landmark not visible).
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
export const getMetricLevel = ({ value, target, tolerance }: MrcMetric): MrcStatusLevel => {
	if (value === null) return "unknown";
	const offset = Math.abs(value - target);
	return (
		offset <= tolerance ? "good"
		: offset <= tolerance * 2 ? "warning"
		: "bad"
	);
};

// MOCK: placeholder values so the layout can be reviewed before the model is
// connected. Replace with real data from the model integration.
export const createMockSession = (joint: MrcJoint): MrcSession => ({
	status: "ready",
	repetitionsDone: 2,
	progress: 0.4,
	metrics: [
		{ id: "primary", kind: "angle", label: `${joint.name} angle`, value: 142, target: 150, tolerance: 10 },
		{ id: "secondary", kind: "angle", label: "Trunk lean", value: 18, target: 0, tolerance: 8 },
		{ id: "alignment", kind: "alignment", label: "Left–right alignment", value: 1.2, target: 0, tolerance: 2 },
		{ id: "hidden", kind: "angle", label: "Opposite side", value: null, target: 150, tolerance: 10 },
	],
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
