"use client";

import { cn } from "cn";
import { BluetoothIcon, BluetoothOffIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import ForceGraph from "@/components/force/force-graph";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import useHhd, { HhdConnection } from "@/hooks/use-hhd";
import { HHD_ERROR_LABEL, HHD_STATUS_LABEL, KG_TO_N } from "@/lib/hhd/protocol";

const GRAPH_WINDOW_SECONDS = 15;

const CONNECTION_BADGE: Record<HhdConnection, { label: string; className: string }> = {
	disconnected: { label: "Disconnected", className: "bg-muted text-muted-foreground" },
	connecting: { label: "Connecting…", className: "bg-amber-500 text-white" },
	connected: { label: "Connected", className: "bg-green-600 text-white" },
	error: { label: "Error", className: "bg-red-600 text-white" },
};

export default function PageToolBluetooth() {
	const { samplesRef, connection, source, error, info, deviceStatus, stats, connect, disconnect } = useHhd();
	const [useSimulator, setUseSimulator] = useState(false);
	const [unit, setUnit] = useState<"kg" | "N">("kg");

	const badge = CONNECTION_BADGE[connection];
	const isBusy = connection === "connecting";
	const isConnected = connection === "connected";
	const toUnit = (kg: number | null) =>
		kg === null ? "—" : `${(unit === "N" ? kg * KG_TO_N : kg).toFixed(unit === "N" ? 1 : 2)} ${unit}`;

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-2xl font-bold">Bluetooth Force Device</h2>
				<p className="text-muted-foreground text-sm">
					Connection test for the HHD force reader (Bluetooth Low Energy). Requires Chrome or Edge.
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
				{/* Connection */}
				<Card>
					<CardHeader className="flex items-center justify-between">
						<CardTitle>Connection</CardTitle>
						<Badge className={badge.className}>{badge.label}</Badge>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<div className="flex items-center justify-between gap-2">
							<div className="flex flex-col">
								<Label htmlFor="hhd-simulator">Use simulated device</Label>
								<span className="text-muted-foreground text-xs">Test without the real hardware</span>
							</div>
							<Switch
								id="hhd-simulator"
								checked={useSimulator}
								disabled={isBusy || isConnected}
								onCheckedChange={setUseSimulator}
							/>
						</div>

						<div className="flex gap-2">
							<Button
								className="flex-1"
								size="lg"
								disabled={isBusy || isConnected}
								onClick={() => connect(useSimulator ? "simulator" : "device")}
							>
								{isBusy ?
									<Loader2Icon className="animate-spin" />
								:	<BluetoothIcon />}
								Connect
							</Button>
							<Button
								className="flex-1"
								size="lg"
								variant="outline"
								disabled={connection === "disconnected" || isBusy}
								onClick={disconnect}
							>
								<BluetoothOffIcon />
								Disconnect
							</Button>
						</div>

						{error && (
							<Alert variant="destructive">
								<TriangleAlertIcon />
								<AlertTitle>Connection problem</AlertTitle>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}

						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
							<InfoRow
								label="Source"
								value={
									source === null ? "—"
									: source === "simulator" ?
										"Simulator"
									:	"Bluetooth"
								}
							/>
							<InfoRow label="Device" value={info?.name ?? "—"} />
							<InfoRow label="Firmware" value={info?.firmware ?? "—"} />
							<InfoRow
								label="Battery"
								value={
									deviceStatus ? `${deviceStatus.batteryPct}%`
									: info ?
										`${info.batteryPct}%`
									:	"—"
								}
							/>
							<InfoRow
								label="Device status"
								value={deviceStatus ? (HHD_STATUS_LABEL[deviceStatus.code] ?? `Unknown (${deviceStatus.code})`) : "—"}
							/>
							{deviceStatus && deviceStatus.errorCode !== 0 && (
								<InfoRow
									label="Device error"
									value={HHD_ERROR_LABEL[deviceStatus.errorCode] ?? `Code ${deviceStatus.errorCode}`}
									alert
								/>
							)}
						</dl>
					</CardContent>
				</Card>

				{/* Live force */}
				<Card>
					<CardHeader className="flex items-center justify-between">
						<CardTitle>Force (last {GRAPH_WINDOW_SECONDS} seconds)</CardTitle>
						<div className="flex gap-1">
							{(["kg", "N"] as const).map((value) => (
								<Button
									key={value}
									size="sm"
									variant={unit === value ? "default" : "outline"}
									onClick={() => setUnit(value)}
								>
									{value}
								</Button>
							))}
						</div>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
							<Stat label="Current force" value={toUnit(stats.latestKg)} highlight />
							<Stat label={`Peak (${GRAPH_WINDOW_SECONDS} s)`} value={toUnit(stats.peakKg)} />
							<Stat label="Sample rate" value={stats.sampleRateHz === null ? "—" : `${stats.sampleRateHz} Hz`} />
							<Stat label="Lost samples" value={String(stats.lostSamples)} alert={stats.lostSamples > 0} />
						</div>
						{stats.overload && (
							<Alert variant="destructive">
								<TriangleAlertIcon />
								<AlertTitle>Overload</AlertTitle>
								<AlertDescription>
									The device reported an overload/error sample in the last 15 seconds.
								</AlertDescription>
							</Alert>
						)}
						<ForceGraph samplesRef={samplesRef} windowSeconds={GRAPH_WINDOW_SECONDS} unit={unit} className="h-80" />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function InfoRow({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className={cn("font-medium", alert && "text-red-600 dark:text-red-400")}>{value}</dd>
		</>
	);
}

function Stat({
	label,
	value,
	highlight,
	alert,
}: {
	label: string;
	value: string;
	highlight?: boolean;
	alert?: boolean;
}) {
	return (
		<div className="flex flex-col gap-0.5 rounded-lg border p-3">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span
				className={cn(
					"font-semibold tabular-nums",
					highlight ? "text-2xl" : "text-lg",
					alert && "text-red-600 dark:text-red-400"
				)}
			>
				{value}
			</span>
		</div>
	);
}
