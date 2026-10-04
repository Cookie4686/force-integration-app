"use client";

import { cn } from "cn";
import { PrinterIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import CameraView from "@/components/camera/camera-view";
import MarkerOverlay from "@/components/marker/marker-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useCamera from "@/hooks/use-camera";
import useMarkerStream from "@/hooks/use-marker-stream";
import {
	DEFAULT_DEVICE_MARKER_ID,
	DEFAULT_MARKER_SIZE_CM,
	DetectedMarker,
	MARKER_COUNT,
	MARKER_DICTIONARY,
	pixelsPerCm,
} from "@/lib/marker/geometry";

const MAX_MARKER_ID = MARKER_COUNT - 1;
// Below this apparent size, detection gets unreliable.
const SMALL_MARKER_PX = 30;

type Stats = {
	device: DetectedMarker | null;
	otherIds: number[];
	detectMs: number | null;
	rateHz: number;
	frame: { width: number; height: number } | null;
};

// Printable marker: the black square is exactly `sizeCm` wide (the SVG adds a white margin).
const printMarker = (svg: string, id: number, sizeCm: number) => {
	const units = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 10);
	const totalMm = (sizeCm * 10 * units) / (units - 2);
	const page = window.open("", "_blank");
	if (!page) return;
	page.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Force device marker · ID ${id}</title>
<style>@page{margin:15mm}body{font-family:sans-serif;text-align:center;color:#111}
svg{display:block;width:${totalMm}mm;height:${totalMm}mm;margin:10mm auto 5mm;outline:1px dashed #999}</style></head>
<body>${svg}<p><b>Force device marker · ID ${id}</b> (${MARKER_DICTIONARY})</p>
<p>The black square must measure exactly ${sizeCm} cm. Print at 100% / “Actual size”, not “Fit to page”.</p>
<script>window.onload = () => window.print();</script></body></html>`);
	page.document.close();
};

export default function PageToolMarker() {
	// 1080p: small markers need every pixel.
	const camera = useCamera({ width: 1920, height: 1080 });
	const marker = useMarkerStream(camera.videoRef);
	const { getMarkerSvg } = marker;
	const [deviceMarkerId, setDeviceMarkerId] = useState(DEFAULT_DEVICE_MARKER_ID);
	const [markerSizeCm, setMarkerSizeCm] = useState(DEFAULT_MARKER_SIZE_CM);
	const [stats, setStats] = useState<Stats>({ device: null, otherIds: [], detectMs: null, rateHz: 0, frame: null });
	// Recent (time, detection count) samples: rate = detections done ÷ time passed.
	const rateSamplesRef = useRef<{ time: number; count: number }[]>([]);

	// Summarise the latest detection a few times per second (drawing uses the ref directly).
	useEffect(() => {
		const timer = setInterval(() => {
			const frame = marker.frameRef.current;
			const now = performance.now();
			const samples = rateSamplesRef.current;
			samples.push({ time: now, count: frame?.count ?? 0 });
			while (samples.length > 2 && samples[0].time < now - 2000) samples.shift();
			const first = samples[0];
			const rateHz =
				now > first.time ? ((samples[samples.length - 1].count - first.count) * 1000) / (now - first.time) : 0;
			setStats({
				device: frame?.markers.find((m) => m.id === deviceMarkerId) ?? null,
				otherIds: frame?.markers.filter((m) => m.id !== deviceMarkerId).map((m) => m.id) ?? [],
				detectMs: frame?.detectMs ?? null,
				rateHz: Math.round(rateHz),
				frame: frame ? { width: frame.width, height: frame.height } : null,
			});
		}, 250);
		return () => clearInterval(timer);
	}, [marker.frameRef, deviceMarkerId]);

	const { device } = stats;
	// Printable marker for the chosen id (generated in the marker worker).
	const [svg, setSvg] = useState<{ id: number; markup: string } | null>(null);
	useEffect(() => {
		let active = true;
		// Retry briefly: the worker may still be starting when the page opens.
		const load = (attempt: number) =>
			getMarkerSvg(deviceMarkerId).then((markup) => {
				if (!active) return;
				if (markup) setSvg({ id: deviceMarkerId, markup });
				else if (attempt < 20) setTimeout(() => load(attempt + 1), 100);
			});
		load(0);
		return () => {
			active = false;
		};
	}, [getMarkerSvg, deviceMarkerId]);

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-2xl font-bold">Force Device Marker</h2>
				<p className="text-muted-foreground text-sm">
					Detection test for the ArUco sticker on the force device. The marker centre is used as the device centre.
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
				<div className="flex flex-col gap-2">
					<CameraView
						camera={camera}
						overlay={<MarkerOverlay frameRef={marker.frameRef} deviceMarkerId={deviceMarkerId} />}
					>
						<div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
							<Badge
								className={cn(
									"text-white",
									marker.status === "error" ? "bg-red-600"
									: device ? "bg-green-600"
									: "bg-amber-500"
								)}
							>
								{marker.status === "error" ?
									"Marker detector failed to load"
								: device ?
									`Device marker found (ID ${device.id})`
								:	"Device marker not found"}
							</Badge>
						</div>
					</CameraView>
					{device && device.sidePx < SMALL_MARKER_PX && (
						<div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm">
							<TriangleAlertIcon className="size-4 shrink-0 text-amber-600" />
							The marker looks small on camera ({Math.round(device.sidePx)} px). Move the camera closer or use a larger
							marker for reliable detection.
						</div>
					)}
				</div>

				<div className="flex flex-col gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Detection</CardTitle>
						</CardHeader>
						<CardContent>
							<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
								<Row
									label="Device centre"
									value={
										device && stats.frame ?
											`x ${Math.round(device.center.x * stats.frame.width)}, y ${Math.round(device.center.y * stats.frame.height)} px`
										:	"—"
									}
								/>
								<Row
									label="Centre (frame %)"
									value={
										device ? `${(device.center.x * 100).toFixed(1)}%, ${(device.center.y * 100).toFixed(1)}%` : "—"
									}
								/>
								<Row label="Size on camera" value={device ? `${Math.round(device.sidePx)} px` : "—"} />
								<Row label="Scale" value={device ? `${pixelsPerCm(device, markerSizeCm).toFixed(1)} px per cm` : "—"} />
								<Row label="Other markers" value={stats.otherIds.length > 0 ? stats.otherIds.join(", ") : "none"} />
								<Row label="Detection time" value={stats.detectMs === null ? "—" : `${stats.detectMs.toFixed(1)} ms`} />
								<Row label="Detection rate" value={`${stats.rateHz} per second`} />
								<Row label="Camera" value={stats.frame ? `${stats.frame.width} × ${stats.frame.height}` : "—"} />
							</dl>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Settings</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<div className="flex flex-col gap-2">
								<Label htmlFor="marker-id">Device marker ID (0–{MAX_MARKER_ID})</Label>
								<Input
									id="marker-id"
									type="number"
									min={0}
									max={MAX_MARKER_ID}
									value={deviceMarkerId}
									onChange={(event) =>
										setDeviceMarkerId(Math.min(MAX_MARKER_ID, Math.max(0, Math.round(Number(event.target.value) || 0))))
									}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="marker-size">Printed marker size (cm, black square)</Label>
								<Input
									id="marker-size"
									type="number"
									min={1}
									max={30}
									step={0.1}
									value={markerSizeCm}
									onChange={(event) =>
										setMarkerSizeCm(Math.max(1, Number(event.target.value) || DEFAULT_MARKER_SIZE_CM))
									}
								/>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Printable marker</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col items-center gap-3">
							{/* SVG generated by js-aruco2 from the dictionary (no user input). */}
							{svg?.id === deviceMarkerId ?
								<div className="size-32" dangerouslySetInnerHTML={{ __html: svg.markup }} />
							:	<div className="bg-muted size-32 animate-pulse rounded" />}
							<p className="text-muted-foreground text-center text-xs">
								ID {deviceMarkerId} · {MARKER_DICTIONARY}. Stick it on the side of the force device, centred.
							</p>
							<Button
								className="w-full"
								disabled={svg?.id !== deviceMarkerId}
								onClick={() => svg && printMarker(svg.markup, deviceMarkerId, markerSizeCm)}
							>
								<PrinterIcon />
								Print {markerSizeCm} cm marker
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium tabular-nums">{value}</dd>
		</>
	);
}
