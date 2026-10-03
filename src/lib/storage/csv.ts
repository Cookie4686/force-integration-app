// CSV export of one session: one row per repetition × measure.

import type { Patient, Session } from "./types";

const HEADER = [
	"patient_name",
	"hn",
	"test_name",
	"session_date",
	"mode",
	"test",
	"side",
	"test_status",
	"rep",
	"duration_s",
	"measure",
	"target",
	"tolerance",
	"min",
	"max",
	"mean",
	"in_tolerance_pct",
	"valid_pct",
];

const cell = (value: string | number | null): string => {
	if (value === null) return "";
	const text = String(value);
	// Quote fields containing separators, quotes or line breaks.
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildSessionCsv = (session: Session, patient: Patient | null): string => {
	const rows: (string | number | null)[][] = [HEADER];
	for (const test of session.tests) {
		for (const rep of test.reps) {
			test.measures.forEach((measure, m) => {
				const metric = rep.metrics[m];
				rows.push([
					patient?.name ?? "",
					patient?.hn ?? "",
					session.name ?? "",
					session.startedAt,
					session.mode,
					test.jointId,
					test.side,
					test.status,
					rep.index,
					Math.round(rep.durationMs / 100) / 10,
					measure.label,
					measure.target,
					measure.tolerance,
					metric?.min ?? null,
					metric?.max ?? null,
					metric?.mean ?? null,
					metric?.inTolerancePct ?? null,
					metric?.validPct ?? null,
				]);
			});
		}
	}
	// BOM so Excel opens UTF-8 correctly (e.g. Thai patient names).
	return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
};
