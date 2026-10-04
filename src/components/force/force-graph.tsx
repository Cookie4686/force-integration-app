"use client";

import { cn } from "cn";
import { useEffect, useRef } from "react";

import { HhdSample, KG_TO_N } from "@/lib/hhd/protocol";

type Theme = { line: string; text: string; grid: string; alert: string };

const readTheme = (element: Element): Theme => {
	const style = getComputedStyle(element);
	return {
		line: style.getPropertyValue("--primary").trim() || "#2563eb",
		text: style.getPropertyValue("--muted-foreground").trim() || "#888",
		grid: style.getPropertyValue("--border").trim() || "#ddd",
		alert: style.getPropertyValue("--destructive").trim() || "#dc2626",
	};
};

// Round up to a "nice" axis step: 1, 2, 5, 10, 20, 50, …
const niceStep = (raw: number): number => {
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const normalized = raw / magnitude;
	return (
		normalized <= 1 ? magnitude
		: normalized <= 2 ? 2 * magnitude
		: normalized <= 5 ? 5 * magnitude
		: 10 * magnitude
	);
};

const PAD = { left: 52, right: 12, top: 12, bottom: 26 };

// Live force-vs-time line chart over the last `windowSeconds` (device clock).
// Reads `samplesRef` every animation frame, so new samples never re-render React.
export default function ForceGraph({
	samplesRef,
	windowSeconds = 15,
	unit = "kg",
	thresholdKg,
	className,
}: {
	samplesRef: React.RefObject<HhdSample[]>;
	windowSeconds?: number;
	unit?: "kg" | "N";
	// Drawn as a dashed line (e.g. the force that starts a repetition).
	thresholdKg?: number;
	className?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const scale = unit === "N" ? KG_TO_N : 1;
		let theme = readTheme(canvas);
		let frame = 0;
		let rafId = 0;

		const draw = () => {
			// Pick up light/dark theme changes about once a second.
			if (++frame % 60 === 0) theme = readTheme(canvas);

			const dpr = window.devicePixelRatio || 1;
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
				canvas.width = Math.round(width * dpr);
				canvas.height = Math.round(height * dpr);
			}
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);

			const plotW = width - PAD.left - PAD.right;
			const plotH = height - PAD.top - PAD.bottom;
			if (plotW <= 0 || plotH <= 0) {
				rafId = requestAnimationFrame(draw);
				return;
			}

			const samples = samplesRef.current;
			const latest = samples[samples.length - 1];
			const tEnd = latest ? latest.timestampMs / 1000 : windowSeconds;
			const tStart = tEnd - windowSeconds;

			// Visible samples (+1 before the window so the line reaches the left edge).
			let first = samples.length;
			while (first > 0 && samples[first - 1].timestampMs / 1000 >= tStart) first--;
			first = Math.max(0, first - 1);

			let maxValue = thresholdKg === undefined ? 0 : thresholdKg * scale;
			for (let i = first; i < samples.length; i++) maxValue = Math.max(maxValue, samples[i].forceKg * scale);
			const step = niceStep(Math.max(maxValue * 1.15, 5 * scale) / 5);
			const yMax = Math.ceil(Math.max(maxValue * 1.15, 5 * scale) / step) * step;

			const x = (t: number) => PAD.left + ((t - tStart) / windowSeconds) * plotW;
			const y = (value: number) => PAD.top + plotH - (Math.max(0, value) / yMax) * plotH;

			// Grid + axis labels.
			ctx.font = "11px sans-serif";
			ctx.lineWidth = 1;
			ctx.strokeStyle = theme.grid;
			ctx.fillStyle = theme.text;
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			for (let value = 0; value <= yMax + 1e-9; value += step) {
				ctx.beginPath();
				ctx.moveTo(PAD.left, Math.round(y(value)) + 0.5);
				ctx.lineTo(PAD.left + plotW, Math.round(y(value)) + 0.5);
				ctx.stroke();
				ctx.fillText(`${Number(value.toFixed(2))} ${unit}`, PAD.left - 6, y(value));
			}
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			for (let ago = windowSeconds; ago >= 0; ago--) {
				const gx = Math.round(x(tEnd - ago)) + 0.5;
				ctx.globalAlpha = ago % 5 === 0 ? 1 : 0.4;
				ctx.beginPath();
				ctx.moveTo(gx, PAD.top);
				ctx.lineTo(gx, PAD.top + plotH);
				ctx.stroke();
				ctx.globalAlpha = 1;
				if (ago % 5 === 0) ctx.fillText(ago === 0 ? "now" : `-${ago} s`, gx, PAD.top + plotH + 6);
			}

			if (thresholdKg !== undefined) {
				const ty = Math.round(y(thresholdKg * scale)) + 0.5;
				ctx.save();
				ctx.strokeStyle = theme.alert;
				ctx.fillStyle = theme.alert;
				ctx.setLineDash([6, 4]);
				ctx.beginPath();
				ctx.moveTo(PAD.left, ty);
				ctx.lineTo(PAD.left + plotW, ty);
				ctx.stroke();
				ctx.textAlign = "left";
				ctx.textBaseline = "bottom";
				ctx.fillText("start", PAD.left + 4, ty - 2);
				ctx.restore();
			}

			if (!latest) {
				ctx.textBaseline = "middle";
				ctx.fillText("No data — connect a device to see the force graph", PAD.left + plotW / 2, PAD.top + plotH / 2);
				rafId = requestAnimationFrame(draw);
				return;
			}

			// Force line, clipped to the plot area.
			ctx.save();
			ctx.beginPath();
			ctx.rect(PAD.left, PAD.top, plotW, plotH);
			ctx.clip();
			ctx.strokeStyle = theme.line;
			ctx.lineWidth = 2;
			ctx.lineJoin = "round";
			ctx.beginPath();
			for (let i = first; i < samples.length; i++) {
				const px = x(samples[i].timestampMs / 1000);
				const py = y(samples[i].forceKg * scale);
				if (i === first) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.stroke();

			// Overload/error samples (device_status 3) as red dots.
			ctx.fillStyle = theme.alert;
			for (let i = first; i < samples.length; i++) {
				if (samples[i].status !== 3) continue;
				ctx.beginPath();
				ctx.arc(x(samples[i].timestampMs / 1000), y(samples[i].forceKg * scale), 3, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.restore();

			rafId = requestAnimationFrame(draw);
		};

		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	}, [samplesRef, windowSeconds, unit, thresholdKg]);

	return <canvas className={cn("block h-72 w-full", className)} ref={canvasRef} />;
}
