import type { Session, SessionDraft } from "@/lib/storage/types";

import { MRC_TESTS, parseRepetitions } from "./joints";

// URL for one MRC test. Query params:
//   ?mode=sequence → part of the full test (moves on to the next test)
//   ?force=off     → without force device: the doctor taps the screen to start/stop each repetition
//   ?session=<id>&patient=<id>&name=<test name> → where results are saved (see app/mrc/actions.ts).
//     Nothing is written until the first repetition, so these travel with the test.
//   ?reps=<n>      → custom repetitions for every test (missing = each joint's default)
export type MrcTestOptions = { sequence: boolean; manual: boolean; session?: SessionDraft };

export const mrcTestHref = (testId: string, { sequence, manual, session }: MrcTestOptions): string => {
	const params = new URLSearchParams();
	if (sequence) params.set("mode", "sequence");
	if (manual) params.set("force", "off");
	if (session) {
		params.set("session", session.id);
		params.set("patient", session.patientId);
		params.set("name", session.name);
		if (session.repetitions !== undefined) params.set("reps", String(session.repetitions));
	}
	const query = params.toString();
	return `/mrc/${testId}${query ? `?${query}` : ""}`;
};

// Rebuild the session draft from a test URL's query (the server validates it again on save).
export const readSessionDraft = (
	query: Record<string, string | string[] | undefined>,
	{ sequence, manual }: { sequence: boolean; manual: boolean }
): SessionDraft | undefined => {
	const { session, patient, name } = query;
	if (typeof session !== "string" || typeof patient !== "string" || typeof name !== "string") return undefined;
	return {
		id: session,
		patientId: patient,
		name,
		mode: manual ? "manual" : "force",
		sequence,
		repetitions: parseRepetitions(query.reps),
	};
};

// "Continue" link for an unfinished record: the first test not completed yet
// (full test: in test order; single test: that test). Null when nothing is left.
export const mrcContinueHref = (session: Session): string | null => {
	const completed = new Set(session.tests.filter((test) => test.status === "completed").map((test) => test.testId));
	const candidates = session.sequence ? MRC_TESTS.map(({ id }) => id) : session.tests.map((test) => test.testId);
	const testId = candidates.find((id) => !completed.has(id));
	if (!testId) return null;
	return mrcTestHref(testId, {
		sequence: session.sequence,
		manual: session.mode === "manual",
		session: {
			id: session.id,
			patientId: session.patientId,
			name: session.name || "Untitled test",
			mode: session.mode,
			sequence: session.sequence,
			repetitions: session.repetitions,
		},
	});
};

// Results page of a session.
export const mrcSessionHref = (sessionId: string): string => `/mrc/session/${sessionId}`;
