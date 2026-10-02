"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
	buildCommand,
	countLostSamples,
	HHD_CHAR,
	HHD_COMMAND,
	HHD_SERVICE_UUID,
	HHD_STATUS_CODE,
	HhdInfo,
	HhdSample,
	HhdStatus,
	parseForcePacket,
	parseInfo,
	parseStatus,
} from "@/lib/hhd/protocol";
import { startHhdSimulator } from "@/lib/hhd/simulator";

export type HhdConnection = "disconnected" | "connecting" | "connected" | "error";
export type HhdSource = "device" | "simulator";

export type HhdStats = {
	latestKg: number | null;
	peakKg: number | null; // over the last STATS_WINDOW_MS
	sampleRateHz: number | null;
	lostSamples: number;
	overload: boolean;
};

const BUFFER_MS = 60_000; // samples kept in memory
const STATS_WINDOW_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const TARE_TIMEOUT_MS = 2_500;

const EMPTY_STATS: HhdStats = { latestKg: null, peakKg: null, sampleRateHz: null, lostSamples: 0, overload: false };

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
	Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

type Gatt = {
	device: BluetoothDevice;
	force: BluetoothRemoteGATTCharacteristic;
	command: BluetoothRemoteGATTCharacteristic;
	status: BluetoothRemoteGATTCharacteristic;
};

// Connects to the HHD force device over Web Bluetooth (or a simulator) and
// streams samples into `samplesRef`. Samples are kept in a ref — not state — so
// a graph can redraw every frame without re-rendering the page.
export default function useHhd() {
	const samplesRef = useRef<HhdSample[]>([]);
	const lastSeqRef = useRef<number | null>(null);
	const lostRef = useRef(0);
	const gattRef = useRef<Gatt | null>(null);
	const stopSimulatorRef = useRef<(() => void) | null>(null);
	// Resolves when the device reports a given status code (used to wait for tare).
	const statusWaiterRef = useRef<{ code: number; resolve: () => void } | null>(null);
	// True while we are disconnecting on purpose, so the disconnect event is not reported as an error.
	const closingRef = useRef(false);

	const [connection, setConnection] = useState<HhdConnection>("disconnected");
	const [source, setSource] = useState<HhdSource | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<HhdInfo | null>(null);
	const [deviceStatus, setDeviceStatus] = useState<HhdStatus | null>(null);
	const [stats, setStats] = useState<HhdStats>(EMPTY_STATS);

	const resetStream = () => {
		samplesRef.current = [];
		lastSeqRef.current = null;
		lostRef.current = 0;
		setStats(EMPTY_STATS);
	};

	const handleSamples = useCallback((samples: HhdSample[]) => {
		const buffer = samplesRef.current;
		for (const sample of samples) {
			if (lastSeqRef.current !== null) lostRef.current += countLostSamples(lastSeqRef.current, sample.seq);
			lastSeqRef.current = sample.seq;
			buffer.push(sample);
		}
		// Drop samples older than BUFFER_MS (device clock).
		const cutoff = buffer[buffer.length - 1].timestampMs - BUFFER_MS;
		let drop = 0;
		while (drop < buffer.length && buffer[drop].timestampMs < cutoff) drop++;
		if (drop > 0) buffer.splice(0, drop);
	}, []);

	const onForce = useCallback(
		(event: Event) => {
			const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
			const samples = value && parseForcePacket(value);
			if (samples) handleSamples(samples); // corrupt packets are discarded
		},
		[handleSamples]
	);

	const onStatus = useCallback((event: Event) => {
		const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
		const status = value && parseStatus(value);
		if (!status) return;
		setDeviceStatus(status);
		if (statusWaiterRef.current?.code === status.code) {
			statusWaiterRef.current.resolve();
			statusWaiterRef.current = null;
		}
	}, []);

	// Tear down the BLE link without touching React state.
	const releaseGatt = useCallback(async () => {
		const gatt = gattRef.current;
		gattRef.current = null;
		if (gatt === null) return;

		gatt.force.removeEventListener("characteristicvaluechanged", onForce);
		gatt.status.removeEventListener("characteristicvaluechanged", onStatus);
		if (gatt.device.gatt?.connected) {
			await gatt.command.writeValueWithResponse(buildCommand(HHD_COMMAND.stopStream)).catch(() => {});
			await gatt.force.stopNotifications().catch(() => {});
			await gatt.status.stopNotifications().catch(() => {});
			gatt.device.gatt.disconnect();
		}
	}, [onForce, onStatus]);

	const onDisconnected = useCallback(() => {
		if (closingRef.current) return;
		// Unexpected drop — the current run is incomplete.
		gattRef.current = null;
		setConnection("error");
		setError("Connection lost. Reconnect to continue.");
	}, []);

	const connectDevice = useCallback(async () => {
		if (!navigator.bluetooth) throw new Error("Web Bluetooth is not supported. Use Chrome or Edge.");

		// Filter by service UUID, not name (names vary between firmware versions).
		const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HHD_SERVICE_UUID] }] });
		device.addEventListener("gattserverdisconnected", onDisconnected);
		if (!device.gatt) throw new Error("This device does not support GATT.");

		// Note: Web Bluetooth negotiates the MTU automatically (the brief asks for 64).
		const server = await withTimeout(device.gatt.connect(), CONNECT_TIMEOUT_MS, "Connection timed out.");
		const service = await server.getPrimaryService(HHD_SERVICE_UUID);
		const [force, command, status, infoChar] = await Promise.all([
			service.getCharacteristic(HHD_CHAR.force),
			service.getCharacteristic(HHD_CHAR.command),
			service.getCharacteristic(HHD_CHAR.status),
			service.getCharacteristic(HHD_CHAR.info),
		]);
		gattRef.current = { device, force, command, status };

		force.addEventListener("characteristicvaluechanged", onForce);
		status.addEventListener("characteristicvaluechanged", onStatus);
		await force.startNotifications();
		await status.startNotifications();

		setInfo(parseInfo(await infoChar.readValue().catch(() => new DataView(new ArrayBuffer(0)))));

		// Tare: TARING → IDLE in ~0.5 s. Do not touch the load cell meanwhile.
		const tared = new Promise<void>((resolve) => {
			statusWaiterRef.current = { code: HHD_STATUS_CODE.idle, resolve };
		});
		await command.writeValueWithResponse(buildCommand(HHD_COMMAND.tare));
		await withTimeout(tared, TARE_TIMEOUT_MS, "Tare timed out. Keep the load cell still and try again.");

		resetStream();
		await command.writeValueWithResponse(buildCommand(HHD_COMMAND.startStream));
	}, [onDisconnected, onForce, onStatus]);

	const connect = useCallback(
		async (nextSource: HhdSource) => {
			setConnection("connecting");
			setSource(nextSource);
			setError(null);
			setInfo(null);
			setDeviceStatus(null);
			closingRef.current = false;

			if (nextSource === "simulator") {
				resetStream();
				stopSimulatorRef.current = startHhdSimulator(handleSamples);
				setInfo({ name: "HHD-SIMULATOR", firmware: "simulated", batteryPct: 100 });
				setDeviceStatus({ code: HHD_STATUS_CODE.streaming, errorCode: 0, batteryPct: 100 });
				setConnection("connected");
				return;
			}

			try {
				await connectDevice();
				setConnection("connected");
			} catch (err) {
				closingRef.current = true;
				await releaseGatt();
				// The user closed the device chooser — not an error.
				if (err instanceof DOMException && err.name === "NotFoundError") {
					setConnection("disconnected");
					return;
				}
				setConnection("error");
				setError(err instanceof Error ? err.message : "Could not connect to the device.");
			}
		},
		[connectDevice, handleSamples, releaseGatt]
	);

	const disconnect = useCallback(async () => {
		closingRef.current = true;
		stopSimulatorRef.current?.();
		stopSimulatorRef.current = null;
		await releaseGatt();
		setConnection("disconnected");
		setError(null);
	}, [releaseGatt]);

	// Refresh the summary numbers a few times per second while connected.
	useEffect(() => {
		if (connection !== "connected") return;
		const timer = setInterval(() => {
			const buffer = samplesRef.current;
			if (buffer.length === 0) return;
			const latest = buffer[buffer.length - 1];

			let peakKg = 0;
			let overload = false;
			let samplesLastSecond = 0;
			for (let i = buffer.length - 1; i >= 0 && buffer[i].timestampMs >= latest.timestampMs - STATS_WINDOW_MS; i--) {
				peakKg = Math.max(peakKg, buffer[i].forceKg);
				overload ||= buffer[i].status === 3;
				if (buffer[i].timestampMs > latest.timestampMs - 1000) samplesLastSecond++;
			}
			setStats({
				latestKg: latest.forceKg,
				peakKg,
				sampleRateHz: samplesLastSecond,
				lostSamples: lostRef.current,
				overload,
			});
		}, 250);
		return () => clearInterval(timer);
	}, [connection]);

	// Release the device when the page unmounts.
	useEffect(() => {
		return () => {
			closingRef.current = true;
			stopSimulatorRef.current?.();
			releaseGatt();
		};
	}, [releaseGatt]);

	return { samplesRef, connection, source, error, info, deviceStatus, stats, connect, disconnect };
}
