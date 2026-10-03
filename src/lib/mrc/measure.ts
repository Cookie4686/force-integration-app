// Turns a joint's `measures` (static config in joints.ts) into live numbers
// from the pose model's landmarks.
//
// Uses MediaPipe's 3D WORLD landmarks (metres, hip-centred), so angles and
// distances do not change with camera distance or image aspect ratio.
// Visibility comes from the 2D landmarks (same person, same order).

import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

import { MrcMeasure } from "./joints";

// Below this visibility a landmark is considered not reliably seen.
export const MIN_MEASURE_VISIBILITY = 0.5;

type Point = { x: number; y: number; z: number };

// Angle at `vertex` between the lines vertex→a and vertex→b, in degrees (0–180).
export const angleAt = (a: Point, vertex: Point, b: Point): number => {
	const u = { x: a.x - vertex.x, y: a.y - vertex.y, z: a.z - vertex.z };
	const v = { x: b.x - vertex.x, y: b.y - vertex.y, z: b.z - vertex.z };
	const dot = u.x * v.x + u.y * v.y + u.z * v.z;
	const cross = Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x);
	// atan2(|u×v|, u·v) stays accurate near 0° and 180°, unlike acos.
	return (Math.atan2(cross, dot) * 180) / Math.PI;
};

// Straight-line distance between two world landmarks, in centimetres.
export const distanceCm = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100;

// Landmark indices a measure depends on.
export const getMeasureLandmarks = (measure: MrcMeasure): number[] =>
	measure.kind === "angle" ? [measure.vertex, ...measure.points] : [...measure.points];

// Live value of one measure (degrees or cm), or null when any landmark it needs
// is missing or not visible enough this frame.
export const computeMeasure = (
	measure: MrcMeasure,
	world: Landmark[] | null | undefined,
	image: NormalizedLandmark[] | null | undefined
): number | null => {
	if (!world || !image) return null;
	const needed = getMeasureLandmarks(measure);
	if (needed.some((i) => !world[i] || (image[i]?.visibility ?? 0) < MIN_MEASURE_VISIBILITY)) return null;

	const [p0, p1] = measure.points;
	return measure.kind === "angle" ?
			angleAt(world[p0], world[measure.vertex], world[p1])
		:	distanceCm(world[p0], world[p1]);
};
