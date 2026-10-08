"use server";

// Server Functions that save MRC test results to data/ (see lib/storage/files.ts).
// Called from client components; every input is validated here.
// A session file is only written once its first repetition is saved, so opening a
// test or a mis-click never leaves an empty session behind.

import type { Patient, RepForce, RepResult, Session, SessionDraft, SessionMode, TestResult } from "@/lib/storage/types";

import { getMeasureLabel, getMrcTest, MAX_REPETITIONS, MIN_REPETITIONS, parseRepetitions } from "@/lib/mrc/joints";
import { addPatient, isValidId, newId, readPatients, updateExistingSession, upsertSession } from "@/lib/storage/files";

const MAX_TEXT = 100;

// Trim and normalise free text. NFC makes the same Thai (or any) text always
// stored with the same characters, so equal names compare equal.
const cleanText = (value: unknown): string =>
	String(value ?? "")
		.normalize("NFC")
		.trim();
// One sample per 100 ms → one hour per repetition is far more than any real rep.
const MAX_RECORDING_SAMPLES = 36_000;

const isNumberOrNull = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));

const assertRep = (rep: RepResult, measureCount: number) => {
	const valid =
		typeof rep === "object"
		&& rep !== null
		&& typeof rep.startedAt === "string"
		&& typeof rep.durationMs === "number"
		&& Number.isFinite(rep.durationMs)
		&& rep.durationMs >= 0
		&& Array.isArray(rep.metrics)
		&& rep.metrics.length === measureCount
		&& rep.metrics.every(
			(metric) =>
				typeof metric?.label === "string"
				&& [metric.min, metric.max, metric.mean, metric.inTolerancePct].every(isNumberOrNull)
				&& typeof metric.validPct === "number"
		)
		&& typeof rep.recording?.intervalMs === "number"
		&& Array.isArray(rep.recording.values)
		&& rep.recording.values.length <= MAX_RECORDING_SAMPLES
		&& rep.recording.values.every(
			(row) => Array.isArray(row) && row.length === measureCount && row.every(isNumberOrNull)
		)
		&& (rep.recording.device === undefined
			|| (Array.isArray(rep.recording.device)
				&& rep.recording.device.length <= MAX_RECORDING_SAMPLES
				&& rep.recording.device.every((value) => value === null || typeof value === "boolean")))
		&& (rep.force === undefined || isValidForce(rep.force))
		&& (rep.device === undefined
			|| (isFiniteNumber(rep.device?.seenPct)
				&& isNumberOrNull(rep.device.inPlacePct)
				&& (rep.device.assumed === undefined || typeof rep.device.assumed === "boolean")))
		&& (rep.warnings === undefined
			|| (Array.isArray(rep.warnings)
				&& rep.warnings.length <= 20
				&& rep.warnings.every((text) => typeof text === "string" && text.length <= 200)));
	if (!valid) throw new Error("Invalid repetition data.");
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// The device sends ~80 samples per second → this is over 20 minutes of pushing.
const MAX_FORCE_SAMPLES = 100_000;

const isValidForce = (force: RepForce) =>
	typeof force === "object"
	&& force !== null
	&& [force.peakKg, force.meanKg, force.timeToPeakMs].every(isFiniteNumber)
	&& typeof force.overload === "boolean"
	&& Array.isArray(force.samples?.t)
	&& Array.isArray(force.samples.kg)
	&& force.samples.t.length === force.samples.kg.length
	&& force.samples.t.length <= MAX_FORCE_SAMPLES
	&& force.samples.t.every(isFiniteNumber)
	&& force.samples.kg.every(isFiniteNumber);

// --- Patients --------------------------------------------------------------------

export async function listPatients(): Promise<Patient[]> {
	return (await readPatients()).sort((a, b) => a.name.localeCompare(b.name, "th"));
}

// Names may repeat (two patients can share a name). HN is optional; when given it must be unique.
export async function createPatient(input: { name: string; hn?: string }): Promise<Patient> {
	const name = cleanText(input?.name);
	const hn = cleanText(input?.hn);
	if (!name) throw new Error("Patient name is required.");
	if (name.length > MAX_TEXT || hn.length > MAX_TEXT) throw new Error("Name or HN is too long.");

	const patients = await readPatients();
	if (hn && patients.some((patient) => patient.hn === hn)) throw new Error(`A patient with HN ${hn} already exists.`);

	const patient: Patient = { id: newId(), name, hn, createdAt: new Date().toISOString() };
	await addPatient(patient);
	return patient;
}

// --- Sessions & tests --------------------------------------------------------------

const cleanSessionName = (value: unknown): string => {
	const name = cleanText(value);
	if (!name) throw new Error("Test name is required.");
	if (name.length > MAX_TEXT) throw new Error("Test name is too long.");
	return name;
};

const assertPatientExists = async (patientId: unknown) => {
	if (!isValidId(patientId)) throw new Error("Invalid patient.");
	if (!(await readPatients()).some((patient) => patient.id === patientId)) throw new Error("Patient not found.");
};

// Custom repetitions: empty → undefined (each joint's default); anything else must be valid.
const cleanRepetitions = (value: unknown): number | undefined => {
	if (value === undefined || value === null || value === "") return undefined;
	const repetitions = parseRepetitions(value);
	if (repetitions === undefined)
		throw new Error(`Repetitions must be a whole number from ${MIN_REPETITIONS} to ${MAX_REPETITIONS}.`);
	return repetitions;
};

// Checks the patient and test name and reserves a session id. Writes NOTHING —
// the session file is created by the first saveRep.
export async function prepareSession(input: {
	patientId: string;
	// Test name chosen by the user (any language; may repeat).
	name: string;
	mode: SessionMode;
	sequence: boolean;
	// Custom repetitions for every test; missing = each joint's default.
	repetitions?: number;
}): Promise<SessionDraft> {
	const name = cleanSessionName(input?.name);
	const repetitions = cleanRepetitions(input?.repetitions);
	await assertPatientExists(input?.patientId);
	return {
		id: newId(),
		patientId: input.patientId,
		name,
		mode: input.mode === "force" ? "force" : "manual",
		sequence: Boolean(input.sequence),
		...(repetitions !== undefined && { repetitions }),
	};
}

// A fresh test entry. The measure targets come from the server's own config, not the client.
// `repetitions`: the custom count, if any (otherwise the joint's default).
const newTestResult = (testId: string, repetitions?: number): TestResult => {
	const test = getMrcTest(testId);
	if (!test) throw new Error("Unknown test.");
	return {
		testId,
		jointId: test.joint.id,
		side: test.side,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		status: "in-progress",
		repetitions: repetitions ?? test.joint.repetitions,
		measures: test.measures.map((measure) => ({
			label: getMeasureLabel(measure),
			kind: measure.kind,
			target: measure.target,
			tolerance: measure.tolerance,
		})),
		reps: [],
	};
};

// Saves one repetition. The first one creates the session file; later ones are
// added after the test's earlier reps (the test page loads those when reopened).
export async function saveRep(draft: SessionDraft, testId: string, rep: RepResult): Promise<void> {
	const name = cleanSessionName(draft?.name);
	const repetitions = cleanRepetitions(draft?.repetitions);
	await assertPatientExists(draft?.patientId);
	const fresh = newTestResult(testId, repetitions); // also rejects an unknown test
	assertRep(rep, fresh.measures.length);

	await upsertSession(
		draft.id,
		(): Session => ({
			id: draft.id,
			patientId: draft.patientId,
			name,
			startedAt: new Date().toISOString(),
			mode: draft.mode === "force" ? "force" : "manual",
			sequence: Boolean(draft.sequence),
			...(repetitions !== undefined && { repetitions }),
			tests: [],
		}),
		(session) => {
			let test = session.tests.find((item) => item.testId === testId);
			if (!test) {
				test = fresh;
				session.tests.push(test);
			}
			test.reps.push({ ...rep, index: test.reps.length + 1 });
			test.status = "in-progress";
			test.finishedAt = null;
		}
	);
}

// Saves a finished video analysis (MRC Test → Video) as a new session in one go:
// one test, all its repetitions. Returns the session id.
export async function saveVideoSession(input: {
	patientId: string;
	name: string;
	testId: string;
	videoName: string;
	// Custom repetitions; missing = the joint's default.
	repetitions?: number;
	reps: RepResult[];
}): Promise<string> {
	const name = cleanSessionName(input?.name);
	const custom = cleanRepetitions(input?.repetitions);
	await assertPatientExists(input?.patientId);
	const test = newTestResult(input?.testId, custom); // also rejects an unknown test
	const repetitions = test.repetitions ?? 0;
	if (!Array.isArray(input.reps) || input.reps.length === 0 || input.reps.length > repetitions)
		throw new Error("Invalid repetition data.");
	for (const rep of input.reps) assertRep(rep, test.measures.length);

	const now = new Date().toISOString();
	test.reps = input.reps.map((rep, idx) => ({ ...rep, index: idx + 1 }));
	if (test.reps.length >= repetitions) {
		test.status = "completed";
		test.finishedAt = now;
	}
	const id = newId();
	await upsertSession(
		id,
		(): Session => ({
			id,
			patientId: input.patientId,
			name,
			startedAt: now,
			mode: "force",
			sequence: false,
			...(custom !== undefined && { repetitions: custom }),
			source: "video",
			videoName: cleanText(input.videoName).slice(0, 200),
			tests: [test],
		}),
		() => {}
	);
	return id;
}

// The three below change an existing session only; before the first saved rep
// there is no file and they do nothing. Removing the last rep deletes the file.

export async function removeLastRep(sessionId: string, testId: string): Promise<void> {
	await updateExistingSession(sessionId, (session) => {
		const test = session.tests.find((item) => item.testId === testId);
		if (!test) return;
		test.reps.pop();
		test.status = "in-progress";
		test.finishedAt = null;
		if (test.reps.length === 0) session.tests = session.tests.filter((item) => item !== test);
	});
}

export async function resetTest(sessionId: string, testId: string): Promise<void> {
	await updateExistingSession(sessionId, (session) => {
		session.tests = session.tests.filter((item) => item.testId !== testId);
	});
}

export async function completeTest(sessionId: string, testId: string): Promise<void> {
	await updateExistingSession(sessionId, (session) => {
		const test = session.tests.find((item) => item.testId === testId);
		if (!test || test.reps.length === 0) return;
		test.status = "completed";
		test.finishedAt = new Date().toISOString();
	});
}
