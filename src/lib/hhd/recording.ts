// Reads a recorded force file (JSON) into the same samples the live device gives.
//
// Accepted shapes:
//   [ { "timestampMs": 0, "forceKg": 0.1 }, … ]                 array of samples
//   { "samples": [ … ] }                                           object with a samples array
//   { "samples": { "t": [0, 12, …], "kg": [0.1, 0.2, …] } }        column arrays (as saved per repetition)
// Per sample, the time may be "timestampMs" | "t" | "time_ms" (milliseconds) and the
// force "forceKg" | "kg" | "force" (kilograms). "seq" and "status" are optional.

import type { HhdSample } from "./protocol";

const TIME_KEYS = ["timestampMs", "t", "time_ms"] as const;
const FORCE_KEYS = ["forceKg", "kg", "force"] as const;

// About 20 minutes at 80 samples per second.
const MAX_SAMPLES = 100_000;

const pick = (row: Record<string, unknown>, keys: readonly string[]): number | null => {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return null;
};

export type ForceRecording = {
	samples: HhdSample[];
	durationMs: number;
	peakKg: number;
	// Average samples per second.
	sampleRateHz: number;
};

// Throws an Error with a message the user can act on when the file is not usable.
export const parseForceRecording = (text: string): ForceRecording => {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("The file is not valid JSON.");
	}

	const container = Array.isArray(data) ? data : (data as { samples?: unknown } | null)?.samples;
	let rows: Record<string, unknown>[];
	if (Array.isArray(container)) {
		rows = container as Record<string, unknown>[];
	} else if (container && typeof container === "object" && "t" in container && "kg" in container) {
		const { t, kg } = container as { t: unknown; kg: unknown };
		if (!Array.isArray(t) || !Array.isArray(kg) || t.length !== kg.length)
			throw new Error('"samples.t" and "samples.kg" must be arrays of the same length.');
		rows = t.map((time, i) => ({ t: time, kg: kg[i] }));
	} else {
		throw new Error('No force samples found. Expected an array of samples or an object with "samples".');
	}

	if (rows.length < 2) throw new Error("The file needs at least 2 force samples.");
	if (rows.length > MAX_SAMPLES) throw new Error(`Too many samples (max ${MAX_SAMPLES.toLocaleString()}).`);

	const samples: HhdSample[] = rows.map((row, i) => {
		const timestampMs = row && typeof row === "object" ? pick(row, TIME_KEYS) : null;
		const forceKg = row && typeof row === "object" ? pick(row, FORCE_KEYS) : null;
		if (timestampMs === null || forceKg === null)
			throw new Error(`Sample ${i + 1} needs a time (timestampMs, ms) and a force (forceKg, kg).`);
		return {
			seq: typeof row.seq === "number" ? row.seq : i & 0xffff,
			timestampMs,
			forceKg,
			status: typeof row.status === "number" ? row.status : 0,
		};
	});

	for (let i = 1; i < samples.length; i++) {
		if (samples[i].timestampMs < samples[i - 1].timestampMs)
			throw new Error(`Sample times must increase (sample ${i + 1} goes back in time).`);
	}

	// Start the recording at 0 ms.
	const start = samples[0].timestampMs;
	for (const sample of samples) sample.timestampMs -= start;
	if (samples[samples.length - 1].timestampMs <= 0) throw new Error("All samples have the same time.");
	return toForceRecording(samples);
};

// Summary of samples that start at 0 ms and increase in time.
const toForceRecording = (samples: HhdSample[]): ForceRecording => {
	const durationMs = samples[samples.length - 1].timestampMs;
	return {
		samples,
		durationMs,
		peakKg: samples.reduce((peak, s) => Math.max(peak, s.forceKg), -Infinity),
		sampleRateHz: durationMs > 0 ? ((samples.length - 1) * 1000) / durationMs : 0,
	};
};

// --- Simulated recording (until the real force file format is known) -----------

const SIMULATED_RATE_HZ = 80;

// A force recording as long as the video, with `pushes` pushes spread evenly over it.
// Each push: rest → ramp up → hold (with tremor) → release → rest, peak 12–20 kg.
export const simulateForceRecording = (durationMs: number, pushes: number): ForceRecording => {
	const slotMs = durationMs / Math.max(1, pushes);
	const peaks = Array.from({ length: pushes }, () => 12 + Math.random() * 8);
	const count = Math.max(2, Math.floor((durationMs / 1000) * SIMULATED_RATE_HZ) + 1);
	const samples: HhdSample[] = [];
	for (let i = 0; i < count; i++) {
		const timestampMs = Math.round((i * 1000) / SIMULATED_RATE_HZ);
		const slot = Math.min(pushes - 1, Math.floor(timestampMs / slotMs));
		const phase = (timestampMs - slot * slotMs) / slotMs; // 0..1 within this push's slot
		const peak = peaks[slot] ?? 0;
		const noise = (Math.random() - 0.5) * 0.08;
		const forceKg =
			phase < 0.2 ? 0
			: phase < 0.35 ? (peak * (phase - 0.2)) / 0.15
			: phase < 0.7 ? peak + Math.sin(timestampMs / 90) * 0.4 + noise * 4
			: phase < 0.8 ? (peak * (0.8 - phase)) / 0.1
			: 0;
		samples.push({ seq: i & 0xffff, timestampMs, forceKg: Math.max(0, forceKg + noise), status: 0 });
	}
	return toForceRecording(samples);
};

// JSON text of a recording in the main accepted shape (an example file for the format).
export const forceRecordingToJson = (recording: ForceRecording): string =>
	JSON.stringify(
		recording.samples.map(({ timestampMs, forceKg }) => ({ timestampMs, forceKg: Math.round(forceKg * 100) / 100 }))
	);
