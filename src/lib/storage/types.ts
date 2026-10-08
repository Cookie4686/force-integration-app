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
	// Custom repetitions for every test in the session (missing = each joint's default).
	repetitions?: number;
	// "video": analysed from a recorded video + force file (MRC Test → Video). Missing = realtime.
	source?: "realtime" | "video";
	// Name of the analysed video file (video sessions only).
	videoName?: string;
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
	// Custom repetitions for every test (missing = each joint's default).
	repetitions?: number;
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
	// Repetitions this test needed (custom or the joint's default). Older sessions: missing = the joint's default.
	repetitions?: number;
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
// Force-device mode also records the device position per sample
// (true = correct, false = wrong, null = could not be checked).
export type RepRecording = { intervalMs: number; values: (number | null)[][]; device?: (boolean | null)[] };

// Force-device mode: the push, from the device's own samples.
export type RepForce = {
	peakKg: number;
	meanKg: number;
	// From the start of the push (force over the start threshold) to the peak.
	timeToPeakMs: number;
	// The device reported an overload/error sample.
	overload: boolean;
	// Raw samples: t = ms since the push started (device clock), kg = force.
	samples: { t: number[]; kg: number[] };
};

// Force-device mode: where the device was during the push.
export type RepDevice = {
	// Share of samples where the position could be checked (marker and landmarks visible), 0–100.
	seenPct: number;
	// Share of checked samples where the device was in the correct place, 0–100.
	inPlacePct: number | null;
	// The marker was never seen (no marker used): the position was assumed correct, not checked.
	assumed?: boolean;
};

export type RepResult = {
	index: number; // 1-based
	startedAt: string;
	durationMs: number;
	metrics: RepMetric[];
	recording: RepRecording;
	// Force-device mode only.
	force?: RepForce;
	device?: RepDevice;
	// Problems noticed during the rep, shown to the doctor (e.g. "Device off position for 40% of the push").
	warnings?: string[];
};
