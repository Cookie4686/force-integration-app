"use client";

import { useEffect, useRef } from "react";

import { PoseFrame } from "@/hooks/use-pose-stream";
import { MrcMeasure } from "@/lib/mrc/joints";
import { POSE_CONNECTIONS } from "@/lib/pose/landmarks";

const MIN_VISIBILITY = 0.5;

const COLOR = {
	bone: "rgba(255, 255, 255, 0.75)",
	joint: "#ffffff",
	highlight: "#fbbf24", // amber-400
	ring: "#ffffff",
	hidden: "#ef4444", // red-500
};

// Landmarks and lines to emphasise, derived from the test's measures.
const getHighlights = (measures: MrcMeasure[]) => {
	const vertices = new Set<number>();
	const points = new Set<number>();
	const lines: { from: number; to: number; dashed: boolean }[] = [];
	for (const measure of measures) {
		if (measure.kind === "angle") {
			vertices.add(measure.vertex);
			measure.points.forEach((point) => {
				points.add(point);
				lines.push({ from: measure.vertex, to: point, dashed: false });
			});
		} else {
			measure.points.forEach((point) => points.add(point));
			lines.push({ from: measure.points[0], to: measure.points[1], dashed: true });
		}
	}
	return { vertices, points, lines };
};

// Draws the tracked patient's skeleton over the camera, with the joints used by
// this test highlighted. Must sit inside the same (mirrored) box as the <video>.
export default function PoseOverlay({
	frameRef,
	measures,
}: {
	frameRef: React.RefObject<PoseFrame | null>;
	measures: MrcMeasure[];
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const highlights = getHighlights(measures);
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
			const visible = (i: number) => (landmarks[i]?.visibility ?? 0) >= MIN_VISIBILITY;

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

			// 1. Whole skeleton.
			ctx.lineCap = "round";
			ctx.lineWidth = 2;
			ctx.strokeStyle = COLOR.bone;
			for (const [from, to] of POSE_CONNECTIONS) if (visible(from) && visible(to)) line(from, to);
			for (let i = 0; i < landmarks.length; i++) if (visible(i)) dot(i, 3, COLOR.joint);

			// 2. Measured segments.
			ctx.lineWidth = 5;
			ctx.strokeStyle = COLOR.highlight;
			for (const { from, to, dashed } of highlights.lines) {
				if (!landmarks[from] || !landmarks[to]) continue;
				ctx.setLineDash(dashed ? [10, 8] : []);
				line(from, to);
			}
			ctx.setLineDash([]);

			// 3. Measured joints: vertex larger with a white ring. A red dashed ring = not visible.
			for (const i of new Set([...highlights.points, ...highlights.vertices])) {
				if (!landmarks[i]) continue;
				const isVertex = highlights.vertices.has(i);
				const radius = isVertex ? 9 : 6;
				dot(i, radius, COLOR.highlight);
				if (isVertex) {
					ctx.lineWidth = 3;
					ctx.strokeStyle = COLOR.ring;
					ctx.beginPath();
					ctx.arc(px(i), py(i), radius + 2, 0, Math.PI * 2);
					ctx.stroke();
				}
				if (!visible(i)) {
					ctx.lineWidth = 2;
					ctx.strokeStyle = COLOR.hidden;
					ctx.setLineDash([4, 4]);
					ctx.beginPath();
					ctx.arc(px(i), py(i), radius + 6, 0, Math.PI * 2);
					ctx.stroke();
					ctx.setLineDash([]);
				}
			}
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [frameRef, measures]);

	return <canvas className="pointer-events-none absolute inset-0 h-full w-full" ref={canvasRef} />;
}
