"use client";

import { useEffect, useRef } from "react";

import type { PoseFrame } from "@/hooks/use-pose-stream";

import { findMarker, MarkerFrame, NormalizedPoint, pixelsPerCm } from "@/lib/marker/geometry";
import { checkDevicePlacement, DevicePlacementStatus } from "@/lib/mrc/device";
import { MrcDevicePlacement } from "@/lib/mrc/joints";
import { MIN_MEASURE_VISIBILITY } from "@/lib/mrc/measure";

import { LEVEL_COLOR } from "./pose-overlay";

const STATUS_COLOR: Record<DevicePlacementStatus, string> = {
	ok: LEVEL_COLOR.good,
	wrong: LEVEL_COLOR.bad,
	"no-device": LEVEL_COLOR.unknown,
	"no-pose": LEVEL_COLOR.unknown,
	assumed: LEVEL_COLOR.unknown,
};

// Without the marker there is no cm scale: draw the zone with this fixed size (px on screen).
const FALLBACK_ZONE_PX = 14;

// Shows where the force device must be: the correct zone on the limb (a band on
// the segment, or a circle around a landmark), and a guide line from the device
// to it, coloured by the device position status. Must sit inside the same
// (mirrored) box as the <video>.
export default function DeviceOverlay({
	poseFrameRef,
	markerFrameRef,
	placement,
	deviceMarkerId,
	markerSizeCm,
}: {
	poseFrameRef: React.RefObject<PoseFrame | null>;
	markerFrameRef: React.RefObject<MarkerFrame | null>;
	placement: MrcDevicePlacement;
	deviceMarkerId: number;
	markerSizeCm: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		let rafId = 0;
		let drawnKey = "";

		const draw = () => {
			rafId = requestAnimationFrame(draw);

			const dpr = window.devicePixelRatio || 1;
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			const pose = poseFrameRef.current;
			const markers = markerFrameRef.current;
			// Redraw only when there is a new detection or the canvas was resized.
			const key = `${width}x${height}x${dpr}:${pose?.time ?? 0}:${markers?.time ?? 0}`;
			if (key === drawnKey) return;
			drawnKey = key;

			if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
				canvas.width = Math.round(width * dpr);
				canvas.height = Math.round(height * dpr);
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);

			const landmarks = pose?.landmarks;
			if (!pose || !landmarks) return;
			const device = findMarker(markers, deviceMarkerId);
			const check = checkDevicePlacement(placement, pose, device, markerSizeCm);
			const color = STATUS_COLOR[check.status];

			// The <video> is object-contain: map frame coordinates into the letterboxed area.
			const scale = Math.min(width / pose.width, height / pose.height);
			const offsetX = (width - pose.width * scale) / 2;
			const offsetY = (height - pose.height * scale) / 2;
			const toScreen = (p: NormalizedPoint) => ({
				x: offsetX + p.x * pose.width * scale,
				y: offsetY + p.y * pose.height * scale,
			});
			const isVisible = (i: number) => (landmarks[i]?.visibility ?? 0) >= MIN_MEASURE_VISIBILITY;
			// Screen pixels per cm at the device's distance.
			const cmPx = device ? pixelsPerCm(device, markerSizeCm) * scale : null;

			// Correct zone.
			ctx.save();
			ctx.globalAlpha = 0.35;
			ctx.fillStyle = color;
			ctx.strokeStyle = color;
			if (placement.kind === "between") {
				if (isVisible(placement.from) && isVisible(placement.to)) {
					const a = toScreen(landmarks[placement.from]);
					const b = toScreen(landmarks[placement.to]);
					const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
					ctx.lineCap = "round";
					ctx.lineWidth = cmPx ? placement.maxOffsetCm * cmPx * 2 : FALLBACK_ZONE_PX;
					ctx.beginPath();
					ctx.moveTo(mid.x, mid.y);
					ctx.lineTo(b.x, b.y);
					ctx.stroke();
				}
			} else if (isVisible(placement.landmark)) {
				const p = toScreen(landmarks[placement.landmark]);
				ctx.beginPath();
				ctx.arc(p.x, p.y, cmPx ? placement.maxDistanceCm * cmPx : FALLBACK_ZONE_PX, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();

			// Guide line: device centre → nearest point of the correct zone.
			if (device && check.guide) {
				const from = toScreen(device.center);
				const to = toScreen(check.guide);
				ctx.save();
				ctx.strokeStyle = color;
				ctx.fillStyle = color;
				ctx.lineWidth = 3;
				if (check.status !== "ok") ctx.setLineDash([8, 6]);
				ctx.beginPath();
				ctx.moveTo(from.x, from.y);
				ctx.lineTo(to.x, to.y);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.beginPath();
				ctx.arc(to.x, to.y, 5, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();
			}
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [poseFrameRef, markerFrameRef, placement, deviceMarkerId, markerSizeCm]);

	return <canvas className="pointer-events-none absolute inset-0 h-full w-full" ref={canvasRef} />;
}
