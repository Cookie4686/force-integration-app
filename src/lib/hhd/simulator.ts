// Fake HHD device for testing without hardware. Emits samples in the same shape
// as the real device: 4 samples per packet, device timestamps, wrapping seq.
// Force profile repeats every 10 s: rest → push up → hold (with tremor) → release.

import { HhdSample } from "./protocol";

const RATE_HZ = 80;
const SAMPLES_PER_PACKET = 4;
const CYCLE_MS = 10_000;

const forceAt = (tMs: number, peakKg: number): number => {
	const t = tMs % CYCLE_MS;
	const noise = (Math.random() - 0.5) * 0.08;
	if (t < 2000) return Math.max(0, noise);
	if (t < 3000) return peakKg * ((t - 2000) / 1000) + noise;
	if (t < 6000) return peakKg + Math.sin(t / 90) * 0.4 + noise * 4;
	if (t < 6700) return peakKg * (1 - (t - 6000) / 700) + noise;
	return Math.max(0, noise);
};

// Starts streaming; returns a function that stops it.
export const startHhdSimulator = (onSamples: (samples: HhdSample[]) => void): (() => void) => {
	let index = 0;
	let peakKg = 15;

	const timer = setInterval(
		() => {
			const samples: HhdSample[] = [];
			for (let i = 0; i < SAMPLES_PER_PACKET; i++, index++) {
				const timestampMs = Math.round((index * 1000) / RATE_HZ);
				// New random peak for each push.
				if (timestampMs % CYCLE_MS === 0) peakKg = 12 + Math.random() * 8;
				samples.push({ seq: index & 0xffff, timestampMs, forceKg: forceAt(timestampMs, peakKg), status: 0 });
			}
			onSamples(samples);
		},
		(SAMPLES_PER_PACKET * 1000) / RATE_HZ
	);

	return () => clearInterval(timer);
};
