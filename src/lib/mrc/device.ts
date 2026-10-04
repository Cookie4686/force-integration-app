// Checks where the force device is against the patient's limb, from the device
// marker (lib/marker) and the pose landmarks. The rule per joint is
// MRC_DEVICE_PLACEMENT in joints.ts.
//
// Both inputs are fractions (0..1) of the same video frame, so they compare
// directly; centimetres come from the marker's apparent size.

import type { DetectedMarker, NormalizedPoint } from "@/lib/marker/geometry";

import { pixelsPerCm } from "@/lib/marker/geometry";
import { POSE_LANDMARK_NAMES, PoseLandmarkIndex } from "@/lib/pose/landmarks";

import { MrcDevicePlacement } from "./joints";
import { MeasureInput, MIN_MEASURE_VISIBILITY } from "./measure";

// "assumed": the marker has not been seen since the test started (the doctor may
// not use one), so the device is taken to be in the correct place.
export type DevicePlacementStatus = "ok" | "wrong" | "no-device" | "no-pose" | "assumed";

export type DevicePlacementCheck = {
	status: DevicePlacementStatus;
	// Short instruction for the doctor.
	message: string;
	// "between": device position along the limb, 0 = `from`, 1 = `to` (correct: 0.5–1).
	position: number | null;
	// "between": distance from the limb line · "near": distance from the landmark (cm).
	distanceCm: number | null;
	// Nearest point of the correct zone, as a fraction of the frame (for the overlay's guide line).
	guide: NormalizedPoint | null;
};

const name = (i: PoseLandmarkIndex) => POSE_LANDMARK_NAMES[i];

export const checkDevicePlacement = (
	placement: MrcDevicePlacement,
	pose: MeasureInput | null | undefined,
	device: DetectedMarker | null,
	markerSizeCm: number
): DevicePlacementCheck => {
	const empty = { position: null, distanceCm: null, guide: null };
	if (!device) return { status: "no-device", message: "Device marker not visible", ...empty };

	const image = pose?.landmarks;
	const needed = placement.kind === "between" ? [placement.from, placement.to] : [placement.landmark];
	const missing = needed.find((i) => !image?.[i] || image[i].visibility < MIN_MEASURE_VISIBILITY);
	if (!pose || !image || missing !== undefined)
		return { status: "no-pose", message: `${name(missing ?? needed[0])} not visible`, ...empty };

	// Work in pixels so a 16:9 frame does not distort distances.
	const { width, height } = pose;
	const px = (p: NormalizedPoint) => ({ x: p.x * width, y: p.y * height });
	const toNormalized = (p: { x: number; y: number }) => ({ x: p.x / width, y: p.y / height });
	const d = px(device.center);
	const perCm = pixelsPerCm(device, markerSizeCm);

	if (placement.kind === "near") {
		const target = px(image[placement.landmark]);
		const distanceCm = Math.hypot(d.x - target.x, d.y - target.y) / perCm;
		const ok = distanceCm <= placement.maxDistanceCm;
		return {
			status: ok ? "ok" : "wrong",
			message:
				ok ?
					`Within ${Math.round(distanceCm)} cm of the ${name(placement.landmark)}`
				:	`Move the device closer to the ${name(placement.landmark)} (${Math.round(distanceCm)} cm away)`,
			position: null,
			distanceCm,
			guide: toNormalized(target),
		};
	}

	// Project the device centre onto the from→to segment.
	const a = px(image[placement.from]);
	const b = px(image[placement.to]);
	const ab = { x: b.x - a.x, y: b.y - a.y };
	const lengthSq = ab.x * ab.x + ab.y * ab.y;
	if (lengthSq === 0) return { status: "no-pose", message: `${name(placement.to)} not visible`, ...empty };
	const position = ((d.x - a.x) * ab.x + (d.y - a.y) * ab.y) / lengthSq;
	// Distance from the infinite line through from→to.
	const distanceCm = Math.abs((d.x - a.x) * ab.y - (d.y - a.y) * ab.x) / Math.sqrt(lengthSq) / perCm;
	// Closer to `to` than to `from` ⇔ past the midpoint.
	const zoneT = Math.min(1, Math.max(0.5, position));
	const guide = toNormalized({ x: a.x + ab.x * zoneT, y: a.y + ab.y * zoneT });

	const message =
		position > 1 ? `Device is past the ${name(placement.to)} — move it toward the ${name(placement.from)}`
		: position <= 0.5 ? `Move the device closer to the ${name(placement.to)}`
		: distanceCm > placement.maxOffsetCm ? `Keep the device on the limb (${Math.round(distanceCm)} cm off the line)`
		: null;
	return {
		status: message === null ? "ok" : "wrong",
		message: message ?? `Between ${name(placement.from)} and ${name(placement.to)}, near the ${name(placement.to)}`,
		position,
		distanceCm,
		guide,
	};
};

export const ASSUMED_DEVICE_CHECK: DevicePlacementCheck = {
	status: "assumed",
	message: "No marker detected — device position assumed correct",
	position: null,
	distanceCm: null,
	guide: null,
};

// Device position over one repetition: true = correct, false = wrong, null = not checked
// (device or landmarks not visible). One entry per recording sample.
export type DeviceRecording = (boolean | null)[];

export const toDeviceRecordingValue = (check: DevicePlacementCheck): boolean | null =>
	check.status === "ok" || check.status === "assumed" ? true
	: check.status === "wrong" ? false
	: null;

const round1 = (value: number): number => Math.round(value * 10) / 10;

// seenPct: share of samples where the position could be checked · inPlacePct: share of those that were correct.
export const summarizeDevice = (rows: DeviceRecording): { seenPct: number; inPlacePct: number | null } => {
	const seen = rows.filter((row) => row !== null);
	return {
		seenPct: rows.length === 0 ? 0 : round1((seen.length / rows.length) * 100),
		inPlacePct: seen.length === 0 ? null : round1((seen.filter(Boolean).length / seen.length) * 100),
	};
};
