// Turns a joint's `measures` (static config in joints.ts) into live numbers
// from the pose model's landmarks.
//
// Angles are measured in the camera picture (2D) by default — see
// MrcAngleMeasure.space. MediaPipe's 3D depth (z) is too noisy for angles: a
// straight arm can read 130–150° in 3D while looking perfectly straight on screen.
// Alignment distances use the 3D WORLD landmarks, because centimetres need real
// scale. Visibility always comes from the 2D landmarks (same person, same order).

import type { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

import { MrcMeasure } from "./joints";

// Below this visibility a landmark is considered not reliably seen.
export const MIN_MEASURE_VISIBILITY = 0.5;

// One detected person, as produced by usePoseStream (PoseFrame).
export type MeasureInput = {
	landmarks: NormalizedLandmark[] | null;
	worldLandmarks: Landmark[] | null;
	// Video frame size, to turn normalized 0..1 coordinates into pixels.
	width: number;
	height: number;
};

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
export const computeMeasure = (measure: MrcMeasure, input: MeasureInput | null | undefined): number | null => {
	const image = input?.landmarks;
	const world = input?.worldLandmarks;
	if (!input || !image) return null;
	const needed = getMeasureLandmarks(measure);
	if (needed.some((i) => !image[i] || image[i].visibility < MIN_MEASURE_VISIBILITY)) return null;

	const [p0, p1] = measure.points;

	if (measure.kind === "inclination") {
		const dx = (image[p1].x - image[p0].x) * input.width;
		const dy = (image[p1].y - image[p0].y) * input.height;
		if (dx === 0 && dy === 0) return null;
		// "Down" = along the trunk (shoulders → hips), or the camera's vertical (image y grows downward).
		let down = { x: 0, y: 1 };
		if ((measure.reference ?? "trunk") === "trunk") {
			const axis = getTrunkAxis(input);
			if (!axis) return null;
			down = {
				x: (axis.bottom.x - axis.top.x) * input.width,
				y: (axis.bottom.y - axis.top.y) * input.height,
			};
			if (down.x === 0 && down.y === 0) return null;
		}
		// Angle between the segment and "down": parallel = 0°, perpendicular = 90°, opposite = 180°.
		const cross = dx * down.y - dy * down.x;
		const dot = dx * down.x + dy * down.y;
		return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
	}

	if (measure.kind === "alignment") {
		if (!world || !world[p0] || !world[p1]) return null;
		return distanceCm(world[p0], world[p1]);
	}

	if (measure.space === "world") {
		if (!world || needed.some((i) => !world[i])) return null;
		return angleAt(world[p0], world[measure.vertex], world[p1]);
	}

	// Image space: pixels, so a 16:9 frame does not squash the angle. z is ignored.
	const pixel = (i: number): Point => ({ x: image[i].x * input.width, y: image[i].y * input.height, z: 0 });
	return angleAt(pixel(p0), pixel(measure.vertex), pixel(p1));
};

// --- Trunk axis (reference for inclination) -----------------------------------

const midpoint = (points: NormalizedLandmark[]) => ({
	x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
	y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

// The patient's own "vertical": centre of the shoulders (top) → centre of the hips
// (bottom), as fractions of the frame. When one side is hidden (side view), the
// visible landmark of that pair is used alone. Null when a pair is not visible at all.
export const getTrunkAxis = (
	input: MeasureInput | null | undefined
): { top: { x: number; y: number }; bottom: { x: number; y: number } } | null => {
	const image = input?.landmarks;
	if (!image) return null;
	const visible = (indices: number[]) =>
		indices.map((i) => image[i]).filter((p) => p !== undefined && p.visibility >= MIN_MEASURE_VISIBILITY);
	const shoulders = visible([11, 12]);
	const hips = visible([23, 24]);
	if (shoulders.length === 0 || hips.length === 0) return null;
	return { top: midpoint(shoulders), bottom: midpoint(hips) };
};

// --- Camera view check ---------------------------------------------------------

// Shoulder width ÷ trunk length: at or below = side-on, above = facing the camera.
// Typical: facing the camera ≈ 0.6–0.9, side-on ≈ 0.1–0.3.
export const FACING_RATIO_THRESHOLD = 0.45;

// Apparent shoulder width ÷ trunk length (shoulder midpoint → hip midpoint), in
// pixels. Small = side-on, large = facing the camera. Null when not measurable.
export const getShoulderWidthRatio = (input: MeasureInput | null | undefined): number | null => {
	const image = input?.landmarks;
	if (!input || !image) return null;
	const [ls, rs, lh, rh] = [11, 12, 23, 24].map((i) => image[i]);
	if (!ls || !rs || !lh || !rh) return null;

	const px = (p: NormalizedLandmark) => ({ x: p.x * input.width, y: p.y * input.height });
	const [a, b, c, d] = [ls, rs, lh, rh].map(px);
	const shoulderWidth = Math.hypot(a.x - b.x, a.y - b.y);
	const trunkLength = Math.hypot((a.x + b.x) / 2 - (c.x + d.x) / 2, (a.y + b.y) / 2 - (c.y + d.y) / 2);
	return trunkLength > 0 ? shoulderWidth / trunkLength : null;
};
