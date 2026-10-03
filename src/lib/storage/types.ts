// Shapes of the saved data (data/patients.json, data/sessions/<id>.json).
// Shared by client and server — no file-system code here.

import type { MrcMeasure, MrcSide } from "@/lib/mrc/joints";

export type Patient = {
	id: string;
	name: string;
	// Hospital number. Optional ("" when not given); unique when given.
	hn: string;
	createdAt: string; // ISO date-time
};

export type SessionMode = "manual" | "force";

// One visit: a full test run or a single test, for one patient.
export type Session = {
	id: string;
	patientId: string;
	// Test name entered when starting (e.g. "Follow-up week 2"). Older sessions may not have one.
	name?: string;
	startedAt: string;
	mode: SessionMode;
	sequence: boolean;
	tests: TestResult[];
};

// What the start popup decides before anything is saved: carried with the test
// (in the URL) and turned into a Session file by the first saved repetition.
export type SessionDraft = {
	id: string;
	patientId: string;
	name: string;
	mode: SessionMode;
	sequence: boolean;
};

// Copied from the joint config when the test starts, so later config changes
// never alter old results.
export type MeasureSnapshot = {
	label: string;
	kind: MrcMeasure["kind"];
	target: number;
	tolerance: number;
};

export type TestResult = {
	testId: string; // e.g. "shoulder-right"
	jointId: string;
	side: MrcSide;
	startedAt: string;
	finishedAt: string | null;
	status: "in-progress" | "completed";
	measures: MeasureSnapshot[];
	reps: RepResult[];
};

// Summary of one measure over one repetition. null = never measured in that rep.
export type RepMetric = {
	label: string;
	min: number | null;
	max: number | null;
	mean: number | null;
	// Share of measured samples within target ± tolerance (0–100).
	inTolerancePct: number | null;
	// Share of samples where the measure could be read at all (0–100).
	validPct: number;
};

// Measure values over the rep: values[sample][measure], one sample every intervalMs.
export type RepRecording = { intervalMs: number; values: (number | null)[][] };

export type RepResult = {
	index: number; // 1-based
	startedAt: string;
	durationMs: number;
	metrics: RepMetric[];
	recording: RepRecording;
};
