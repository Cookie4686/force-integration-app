// Reads and writes the saved data as JSON files on this computer:
//   data/patients.json             all patients
//   data/sessions/<sessionId>.json one file per session — written only once it
//                                  has at least one repetition, deleted when the last one is removed
// Server only — imported by Server Functions and Route Handlers.

import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Patient, Session } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const PATIENTS_FILE = path.join(DATA_DIR, "patients.json");

// Ids are crypto.randomUUID() values. Checking the format before building a file
// path means a request can never reach files outside data/ (path traversal).
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const newId = (): string => randomUUID();

export const isValidId = (id: unknown): id is string => typeof id === "string" && ID_PATTERN.test(id);

const sessionFile = (id: string): string => {
	if (!isValidId(id)) throw new Error("Invalid session id.");
	return path.join(SESSIONS_DIR, `${id}.json`);
};

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
	try {
		return JSON.parse(await readFile(file, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
		throw error;
	}
};

// Write to a temp file, then rename over the target: a crash mid-write never
// leaves a half-written file. Retries briefly if Windows has the file locked
// (e.g. antivirus scanning it).
const writeJsonAtomic = async (file: string, data: unknown): Promise<void> => {
	await mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
	for (let attempt = 0; ; attempt++) {
		try {
			await rename(tmp, file);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY")) throw error;
			await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
		}
	}
};

// Read-modify-write operations on the same file run one at a time, so two quick
// saves (e.g. last rep + "test complete") never overwrite each other.
const fileQueues = new Map<string, Promise<unknown>>();
const withFileLock = <T>(file: string, task: () => Promise<T>): Promise<T> => {
	const result = (fileQueues.get(file) ?? Promise.resolve()).then(task, task);
	fileQueues.set(
		file,
		result.catch(() => {})
	);
	return result;
};

// --- Patients --------------------------------------------------------------------

export const readPatients = (): Promise<Patient[]> => readJson<Patient[]>(PATIENTS_FILE, []);

export const addPatient = (patient: Patient): Promise<void> =>
	withFileLock(PATIENTS_FILE, async () => {
		const patients = await readPatients();
		await writeJsonAtomic(PATIENTS_FILE, [...patients, patient]);
	});

// --- Sessions --------------------------------------------------------------------

export const readSession = (id: string): Promise<Session | null> => readJson<Session | null>(sessionFile(id), null);

const countReps = (session: Session): number => session.tests.reduce((sum, test) => sum + test.reps.length, 0);

// Save the session, or delete its file when no repetition is left — so every
// session file on disk always holds at least one repetition.
const writeOrDeleteSession = async (file: string, session: Session): Promise<void> => {
	if (countReps(session) > 0) {
		await writeJsonAtomic(file, session);
		return;
	}
	await unlink(file).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
	});
};

// Load the session (or `create` it when it has no file yet), let `change` modify it, then save.
export const upsertSession = (id: string, create: () => Session, change: (session: Session) => void): Promise<void> => {
	const file = sessionFile(id);
	return withFileLock(file, async () => {
		const session = (await readJson<Session | null>(file, null)) ?? create();
		change(session);
		await writeOrDeleteSession(file, session);
	});
};

// Modify a session that already has a file; does nothing when it has none
// (e.g. "undo" before any repetition was saved).
export const updateExistingSession = (id: string, change: (session: Session) => void): Promise<void> => {
	const file = sessionFile(id);
	return withFileLock(file, async () => {
		const session = await readJson<Session | null>(file, null);
		if (session === null) return;
		change(session);
		await writeOrDeleteSession(file, session);
	});
};
