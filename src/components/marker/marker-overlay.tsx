"use client";

import { useEffect, useRef } from "react";

import type { MarkerFrame } from "@/lib/marker/geometry";

const COLOR = {
	device: "#22c55e", // green-500: the force device's marker
	other: "#9ca3af", // gray-400: any other marker in view
	corner: "#f59e0b", // amber-500: first corner (shows the marker's rotation)
	label: "#ffffff",
};

// Outlines detected markers over the camera and marks the device centre.
// Must sit inside the same (mirrored) box as the <video>.
export default function MarkerOverlay({
	frameRef,
	deviceMarkerId,
	mirrored = true,
}: {
	frameRef: React.RefObject<MarkerFrame | null>;
	// The marker on the force device; others are drawn grey.
	deviceMarkerId: number;
	// Must match the camera's mirroring so labels can be flipped back to readable.
	mirrored?: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

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
			if ((frame?.time ?? 0) === drawnTime && size === drawnSize) return;
			drawnTime = frame?.time ?? 0;
			drawnSize = size;

			if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
				canvas.width = Math.round(width * dpr);
				canvas.height = Math.round(height * dpr);
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);
			if (!frame) return;

			// The <video> is object-contain: map frame coordinates into the letterboxed area.
			const scale = Math.min(width / frame.width, height / frame.height);
			const offsetX = (width - frame.width * scale) / 2;
			const offsetY = (height - frame.height * scale) / 2;
			const px = (x: number) => offsetX + x * frame.width * scale;
			const py = (y: number) => offsetY + y * frame.height * scale;

			ctx.font = "bold 14px sans-serif";
			ctx.textBaseline = "middle";
			for (const marker of frame.markers) {
				const isDevice = marker.id === deviceMarkerId;
				const color = isDevice ? COLOR.device : COLOR.other;

				// Outline.
				ctx.lineWidth = isDevice ? 4 : 2;
				ctx.strokeStyle = color;
				ctx.beginPath();
				marker.corners.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.x), py(p.y)) : ctx.lineTo(px(p.x), py(p.y))));
				ctx.closePath();
				ctx.stroke();

				// First corner.
				ctx.fillStyle = COLOR.corner;
				ctx.beginPath();
				ctx.arc(px(marker.corners[0].x), py(marker.corners[0].y), 4, 0, Math.PI * 2);
				ctx.fill();

				// Device centre: crosshair.
				const cx = px(marker.center.x);
				const cy = py(marker.center.y);
				if (isDevice) {
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.moveTo(cx - 14, cy);
					ctx.lineTo(cx + 14, cy);
					ctx.moveTo(cx, cy - 14);
					ctx.lineTo(cx, cy + 14);
					ctx.stroke();
				}

				// Label, flipped back so it reads normally on the mirrored canvas.
				const text = isDevice ? `Device (ID ${marker.id})` : `ID ${marker.id}`;
				const halfSide = (marker.sidePx * scale) / 2;
				ctx.save();
				ctx.translate(cx, cy - halfSide - 16);
				if (mirrored) ctx.scale(-1, 1);
				const textWidth = ctx.measureText(text).width;
				ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
				ctx.beginPath();
				ctx.roundRect(-textWidth / 2 - 6, -11, textWidth + 12, 22, 6);
				ctx.fill();
				ctx.fillStyle = isDevice ? COLOR.device : COLOR.label;
				ctx.textAlign = "center";
				ctx.fillText(text, 0, 0);
				ctx.restore();
			}
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [frameRef, deviceMarkerId, mirrored]);

	return <canvas className="pointer-events-none absolute inset-0 h-full w-full" ref={canvasRef} />;
}
