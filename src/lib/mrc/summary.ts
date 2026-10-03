// Summarises the measure values recorded during one repetition.

import type { RepMetric } from "@/lib/storage/types";

import { getMeasureLabel, MrcMeasure } from "./joints";
import { getMetricLevel } from "./session";

const round1 = (value: number): number => Math.round(value * 10) / 10;

// values[sample][measure] → one RepMetric per measure (same order as `measures`).
export const summarizeRep = (measures: MrcMeasure[], values: (number | null)[][]): RepMetric[] =>
	measures.map((measure, m) => {
		const label = getMeasureLabel(measure);
		let count = 0;
		let sum = 0;
		let min = Infinity;
		let max = -Infinity;
		let inTolerance = 0;
		for (const row of values) {
			const value = row[m];
			if (value === null || value === undefined || !Number.isFinite(value)) continue;
			count++;
			sum += value;
			min = Math.min(min, value);
			max = Math.max(max, value);
			if (getMetricLevel({ value, target: measure.target, tolerance: measure.tolerance }) === "good") inTolerance++;
		}

		if (count === 0) return { label, min: null, max: null, mean: null, inTolerancePct: null, validPct: 0 };
		return {
			label,
			min: round1(min),
			max: round1(max),
			mean: round1(sum / count),
			inTolerancePct: round1((inTolerance / count) * 100),
			validPct: round1((count / values.length) * 100),
		};
	});

// Recorded values are kept to 0.1 to keep files small.
export const roundRecordingRow = (row: (number | null)[]): (number | null)[] =>
	row.map((value) => (value === null ? null : round1(value)));
