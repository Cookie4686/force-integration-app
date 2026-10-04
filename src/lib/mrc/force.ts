// Force-device mode: a repetition is one push on the force device.
//   starts: force rises to FORCE_REP.startKg or more
//   ends:   force falls back below FORCE_REP.endKg (released)
// Two thresholds (start > end) stop a noisy reading near one value from
// starting and ending reps over and over.

import type { HhdSample } from "@/lib/hhd/protocol";
import type { RepDevice, RepForce, RepMetric } from "@/lib/storage/types";

export const FORCE_REP = {
	startKg: 2,
	endKg: 0.5,
	// Shorter pushes are bumps, not repetitions — ignored.
	minDurationMs: 300,
};

// Time shown on the force graph.
export const FORCE_GRAPH_WINDOW_SECONDS = 10;

// When to warn the doctor about a repetition.
export const REP_WARNING = {
	// Device position checked (marker + landmarks visible) in less than this share of the push.
	minDeviceSeenPct: 50,
	// Device in the correct place in less than this share of the checked samples.
	minDeviceInPlacePct: 80,
	// A posture measure within tolerance in less than this share of the push.
	minInTolerancePct: 50,
};

export type ForceRepEvent =
	| { type: "start" }
	| { type: "end"; durationMs: number; samples: HhdSample[] }
	// Released before FORCE_REP.minDurationMs.
	| { type: "discard"; durationMs: number };

// Feed device samples in order; reports when a push starts and ends.
export const createForceRepDetector = () => {
	let samples: HhdSample[] | null = null;
	let peakKg = 0;
	return {
		push(sample: HhdSample): ForceRepEvent | null {
			if (samples === null) {
				if (sample.forceKg < FORCE_REP.startKg) return null;
				samples = [sample];
				peakKg = sample.forceKg;
				return { type: "start" };
			}
			samples.push(sample);
			peakKg = Math.max(peakKg, sample.forceKg);
			if (sample.forceKg >= FORCE_REP.endKg) return null;
			const done = samples;
			samples = null;
			const durationMs = done[done.length - 1].timestampMs - done[0].timestampMs;
			return durationMs < FORCE_REP.minDurationMs ?
					{ type: "discard", durationMs }
				:	{ type: "end", durationMs, samples: done };
		},
		// Highest force so far in the current push (null when not pushing).
		peakKg: () => (samples === null ? null : peakKg),
		reset() {
			samples = null;
		},
	};
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const summarizeForce = (samples: HhdSample[]): RepForce => {
	const start = samples[0].timestampMs;
	let peak = samples[0];
	let sum = 0;
	for (const sample of samples) {
		if (sample.forceKg > peak.forceKg) peak = sample;
		sum += sample.forceKg;
	}
	return {
		peakKg: round2(peak.forceKg),
		meanKg: round2(sum / samples.length),
		timeToPeakMs: peak.timestampMs - start,
		overload: samples.some((sample) => sample.status === 3),
		samples: { t: samples.map((s) => s.timestampMs - start), kg: samples.map((s) => round2(s.forceKg)) },
	};
};

// What the doctor should double-check about a finished repetition.
export const getRepWarnings = ({
	force,
	device,
	metrics,
}: {
	force: RepForce;
	device: RepDevice;
	metrics: RepMetric[];
}): string[] => {
	const warnings: string[] = [];
	if (force.overload) warnings.push("Force overload — the reading may be cut off");
	if (device.assumed) {
		// No marker in use: nothing to check.
	} else if (device.seenPct < REP_WARNING.minDeviceSeenPct)
		warnings.push("Device position not visible for most of the push");
	else if (device.inPlacePct !== null && device.inPlacePct < REP_WARNING.minDeviceInPlacePct)
		warnings.push(`Device off position for ${Math.round(100 - device.inPlacePct)}% of the push`);
	for (const metric of metrics) {
		if (metric.inTolerancePct === null) warnings.push(`${metric.label}: not visible during the push`);
		else if (metric.inTolerancePct < REP_WARNING.minInTolerancePct)
			warnings.push(`${metric.label}: out of tolerance for ${Math.round(100 - metric.inTolerancePct)}% of the push`);
	}
	return warnings;
};
