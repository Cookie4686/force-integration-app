"use client";

import { useEffect, useRef } from "react";

import { PoseFrame } from "@/hooks/use-pose-stream";
import { getMeasureVertex, MrcMeasure } from "@/lib/mrc/joints";
import { computeMeasure, MIN_MEASURE_VISIBILITY } from "@/lib/mrc/measure";
import { getMetricLevel, METRIC_UNIT, MrcStatusLevel } from "@/lib/mrc/session";
import { POSE_CONNECTIONS } from "@/lib/pose/landmarks";

const COLOR = {
	bone: "rgba(255, 255, 255, 0.75)",
	joint: "#ffffff",
	reference: "#38bdf8", // sky-400: the other points of a measure
	ring: "#ffffff",
};

// Same meaning as the Angle Dashboard: on target / adjust / off / not measured.
export const LEVEL_COLOR: Record<MrcStatusLevel, string> = {
	good: "#22c55e",
	warning: "#f59e0b",
	bad: "#ef4444",
	unknown: "#9ca3af",
};

// Draws the tracked patient's skeleton over the camera. The joints used by this
// test are highlighted and coloured by their live status, with the value written
// next to the measured joint. Must sit inside the same (mirrored) box as the <video>.
export default function PoseOverlay({
	frameRef,
	measures,
	mirrored = true,
}: {
	frameRef: React.RefObject<PoseFrame | null>;
	measures: MrcMeasure[];
	// Must match the camera's mirroring so the value labels can be flipped back to readable.
	mirrored?: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const vertices = new Set(measures.flatMap((m) => getMeasureVertex(m) ?? []));
		const references = new Set(measures.flatMap((m) => m.points).filter((i) => !vertices.has(i)));
		let rafId = 0;
		let drawnTime = -1;
		let drawnSize = "";

		const draw = () => {
			rafId = requestAnimationFrame(draw);

			const dpr = window.devicePixelRatio || 1;
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			const frame = frameRef.current;
			const size = `${width}x${height}x${dpr}`;
			// Redraw only when there is a new detection or the canvas was resized.
			if ((frame?.time ?? 0) === drawnTime && size === drawnSize) return;
			drawnTime = frame?.time ?? 0;
			drawnSize = size;

			if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
				canvas.width = Math.round(width * dpr);
				canvas.height = Math.round(height * dpr);
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);

			const landmarks = frame?.landmarks;
			if (!frame || !landmarks) return;

			// The <video> is object-contain: map frame coordinates into the letterboxed area.
			const scale = Math.min(width / frame.width, height / frame.height);
			const offsetX = (width - frame.width * scale) / 2;
			const offsetY = (height - frame.height * scale) / 2;
			const px = (i: number) => offsetX + landmarks[i].x * frame.width * scale;
			const py = (i: number) => offsetY + landmarks[i].y * frame.height * scale;
			const visible = (i: number) => (landmarks[i]?.visibility ?? 0) >= MIN_MEASURE_VISIBILITY;

			const line = (from: number, to: number) => {
				ctx.beginPath();
				ctx.moveTo(px(from), py(from));
				ctx.lineTo(px(to), py(to));
				ctx.stroke();
			};
			const dot = (i: number, radius: number, fill: string) => {
				ctx.beginPath();
				ctx.arc(px(i), py(i), radius, 0, Math.PI * 2);
				ctx.fillStyle = fill;
				ctx.fill();
			};
			const ring = (i: number, radius: number, stroke: string, dashed = false) => {
				ctx.lineWidth = dashed ? 2 : 3;
				ctx.strokeStyle = stroke;
				ctx.setLineDash(dashed ? [4, 4] : []);
				ctx.beginPath();
				ctx.arc(px(i), py(i), radius, 0, Math.PI * 2);
				ctx.stroke();
				ctx.setLineDash([]);
			};

			// 1. Whole skeleton.
			ctx.lineCap = "round";
			ctx.lineWidth = 2;
			ctx.strokeStyle = COLOR.bone;
			for (const [from, to] of POSE_CONNECTIONS) if (visible(from) && visible(to)) line(from, to);
			for (let i = 0; i < landmarks.length; i++) if (visible(i)) dot(i, 3, COLOR.joint);

			// 2. Measured segments, coloured by each measure's live status.
			const results = measures.map((measure) => {
				const value = computeMeasure(measure, frame);
				return {
					measure,
					value,
					level: getMetricLevel({ value, target: measure.target, tolerance: measure.tolerance }),
				};
			});
			ctx.lineWidth = 5;
			for (const { measure, level } of results) {
				ctx.strokeStyle = LEVEL_COLOR[level];
				if (measure.kind === "angle") {
					line(measure.vertex, measure.points[0]);
					line(measure.vertex, measure.points[1]);
				} else if (measure.kind === "inclination") {
					const [from, to] = measure.points;
					line(from, to);
					// Dashed vertical reference (straight down), same length as the segment.
					const length = Math.hypot(px(to) - px(from), py(to) - py(from));
					ctx.save();
					ctx.lineWidth = 2;
					ctx.strokeStyle = COLOR.ring;
					ctx.setLineDash([6, 6]);
					ctx.beginPath();
					ctx.moveTo(px(from), py(from));
					ctx.lineTo(px(from), py(from) + length);
					ctx.stroke();
					ctx.restore();
				} else {
					ctx.setLineDash([10, 8]);
					line(measure.points[0], measure.points[1]);
					ctx.setLineDash([]);
				}
			}

			// 3. Reference points.
			for (const i of references) {
				dot(i, 6, COLOR.reference);
				if (!visible(i)) ring(i, 11, LEVEL_COLOR.unknown, true);
			}

			// 4. Measured joints (angle vertex / inclination start): larger dot + white ring + value label.
			ctx.font = "bold 16px sans-serif";
			ctx.textBaseline = "middle";
			for (const { measure, value, level } of results) {
				const i = getMeasureVertex(measure);
				if (i === null) continue;
				dot(i, 9, LEVEL_COLOR[level]);
				ring(i, 11, COLOR.ring);
				if (!visible(i)) ring(i, 16, LEVEL_COLOR.unknown, true);

				const text = value === null ? "—" : `${Math.round(value)}${METRIC_UNIT[measure.kind]}`;
				// Flip the text back so it reads normally on the mirrored canvas.
				ctx.save();
				ctx.translate(px(i), py(i));
				if (mirrored) ctx.scale(-1, 1);
				const textX = 18;
				const textWidth = ctx.measureText(text).width;
				ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
				ctx.beginPath();
				ctx.roundRect(textX - 6, -13, textWidth + 12, 26, 6);
				ctx.fill();
				ctx.fillStyle = LEVEL_COLOR[level];
				ctx.fillText(text, textX, 0);
				ctx.restore();
			}
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [frameRef, measures, mirrored]);

	return <canvas className="pointer-events-none absolute inset-0 h-full w-full" ref={canvasRef} />;
}
