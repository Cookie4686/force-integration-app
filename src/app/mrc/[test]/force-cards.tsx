"use client";

import { cn } from "cn";
import {
	BluetoothIcon,
	BluetoothOffIcon,
	CircleCheckIcon,
	CircleHelpIcon,
	CircleXIcon,
	Loader2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";

import ForceGraph from "@/components/force/force-graph";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HhdContextValue } from "@/context/hhd-context";
import { HhdConnection } from "@/hooks/use-hhd";
import { DEFAULT_DEVICE_MARKER_ID } from "@/lib/marker/geometry";
import { DevicePlacementCheck, DevicePlacementStatus } from "@/lib/mrc/device";
import { FORCE_GRAPH_WINDOW_SECONDS, FORCE_REP } from "@/lib/mrc/force";
import { getDevicePlacementLabel, MrcDevicePlacement } from "@/lib/mrc/joints";

const CONNECTION_BADGE: Record<HhdConnection, { label: string; className: string }> = {
	disconnected: { label: "Disconnected", className: "bg-muted text-muted-foreground" },
	connecting: { label: "Connecting…", className: "bg-amber-500 text-white" },
	connected: { label: "Connected", className: "bg-green-600 text-white" },
	error: { label: "Error", className: "bg-red-600 text-white" },
};

const formatKg = (kg: number | null | undefined) => (kg === null || kg === undefined ? "—" : `${kg.toFixed(1)} kg`);

// --- Force ---------------------------------------------------------------------

export function ForceCard({
	hhd,
	activePeakKg,
	lastPeakKg,
}: {
	hhd: HhdContextValue;
	// Peak of the push in progress (null when not pushing).
	activePeakKg: number | null;
	// Peak of the last finished repetition.
	lastPeakKg: number | undefined;
}) {
	const { samplesRef, connection, error, info, stats, connect, disconnect } = hhd;
	const [useSimulator, setUseSimulator] = useState(false);
	const badge = CONNECTION_BADGE[connection];
	const isBusy = connection === "connecting";
	const isConnected = connection === "connected";

	return (
		<Card>
			<CardHeader className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<CardTitle>Force (last {FORCE_GRAPH_WINDOW_SECONDS} seconds)</CardTitle>
					<Badge className={badge.className}>{badge.label}</Badge>
					{info && isConnected && <span className="text-muted-foreground text-xs">{info.name}</span>}
				</div>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Switch
							id="force-simulator"
							checked={useSimulator}
							disabled={isBusy || isConnected}
							onCheckedChange={setUseSimulator}
						/>
						<Label className="text-xs" htmlFor="force-simulator">
							Simulated device
						</Label>
					</div>
					{isConnected || connection === "error" ?
						<Button size="sm" variant="outline" disabled={isBusy} onClick={disconnect}>
							<BluetoothOffIcon />
							Disconnect
						</Button>
					:	<Button size="sm" disabled={isBusy} onClick={() => connect(useSimulator ? "simulator" : "device")}>
							{isBusy ?
								<Loader2Icon className="animate-spin" />
							:	<BluetoothIcon />}
							Connect
						</Button>
					}
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{error && (
					<Alert variant="destructive">
						<TriangleAlertIcon />
						<AlertTitle>Connection problem</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					<Stat label="Current force" value={isConnected ? formatKg(stats.latestKg) : "—"} highlight />
					<Stat label="Peak (this push)" value={formatKg(activePeakKg)} />
					<Stat label="Peak (last repetition)" value={formatKg(lastPeakKg)} />
					<Stat label="Repetition starts at" value={`${FORCE_REP.startKg} kg`} />
				</div>
				{stats.overload && isConnected && (
					<Alert variant="destructive">
						<TriangleAlertIcon />
						<AlertTitle>Overload</AlertTitle>
						<AlertDescription>The device reported an overload/error sample recently.</AlertDescription>
					</Alert>
				)}
				<ForceGraph
					samplesRef={samplesRef}
					windowSeconds={FORCE_GRAPH_WINDOW_SECONDS}
					thresholdKg={FORCE_REP.startKg}
					className="h-56"
				/>
			</CardContent>
		</Card>
	);
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
	return (
		<div className="flex flex-col gap-0.5 rounded-lg border p-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className={cn("font-semibold tabular-nums", highlight ? "text-2xl" : "text-lg")}>{value}</span>
		</div>
	);
}

// --- Device position -----------------------------------------------------------

export const DEVICE_STATUS_STYLE: Record<
	DevicePlacementStatus,
	{ label: string; text: string; badge: string; icon: typeof CircleCheckIcon }
> = {
	ok: {
		label: "Device in position",
		text: "text-green-600 dark:text-green-400",
		badge: "bg-green-600 text-white",
		icon: CircleCheckIcon,
	},
	wrong: {
		label: "Device out of position",
		text: "text-red-600 dark:text-red-400",
		badge: "bg-red-600 text-white",
		icon: CircleXIcon,
	},
	"no-device": {
		label: "Device not found",
		text: "text-muted-foreground",
		badge: "bg-amber-500 text-white",
		icon: CircleHelpIcon,
	},
	assumed: {
		label: "Position assumed (no marker)",
		text: "text-muted-foreground",
		badge: "bg-black/70 text-white",
		icon: CircleHelpIcon,
	},
	"no-pose": {
		label: "Limb not visible",
		text: "text-muted-foreground",
		badge: "bg-amber-500 text-white",
		icon: CircleHelpIcon,
	},
};

// Below this apparent size, marker detection gets unreliable.
const SMALL_MARKER_PX = 30;

export function DevicePositionCard({
	placement,
	check,
	markerSidePx,
	markerFailed,
}: {
	placement: MrcDevicePlacement;
	check: DevicePlacementCheck;
	// Apparent marker size, when the marker is in view.
	markerSidePx: number | null;
	markerFailed: boolean;
}) {
	const style = DEVICE_STATUS_STYLE[check.status];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Device Position</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className={cn("flex items-start gap-2 font-semibold", style.text)}>
					<style.icon className="mt-0.5 size-5 shrink-0" />
					<span>{check.message}</span>
				</div>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
					<dt className="text-muted-foreground">Rule</dt>
					<dd className="font-medium">{getDevicePlacementLabel(placement)}</dd>
					{placement.kind === "between" && (
						<>
							<dt className="text-muted-foreground">Along the limb</dt>
							<dd className="font-medium tabular-nums">
								{check.position === null ? "—" : `${Math.round(check.position * 100)}% (needs 50–100%)`}
							</dd>
						</>
					)}
					<dt className="text-muted-foreground">{placement.kind === "between" ? "Off the limb line" : "Distance"}</dt>
					<dd className="font-medium tabular-nums">
						{check.distanceCm === null ? "—" : `${check.distanceCm.toFixed(1)} cm`} (max{" "}
						{placement.kind === "between" ? placement.maxOffsetCm : placement.maxDistanceCm} cm)
					</dd>
					<dt className="text-muted-foreground">Marker</dt>
					<dd className="font-medium tabular-nums">
						ID {DEFAULT_DEVICE_MARKER_ID} · {markerSidePx === null ? "not in view" : `${Math.round(markerSidePx)} px`}
					</dd>
				</dl>
				{markerFailed && <p className="text-sm text-red-600 dark:text-red-400">The marker detector failed to load.</p>}
				{markerSidePx !== null && markerSidePx < SMALL_MARKER_PX && (
					<p className="text-sm text-amber-600 dark:text-amber-400">
						The marker looks small on camera. Move the camera closer for reliable tracking.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
