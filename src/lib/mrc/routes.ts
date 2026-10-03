import type { SessionDraft } from "@/lib/storage/types";

// URL for one MRC test. Query params:
//   ?mode=sequence → part of the full test (moves on to the next test)
//   ?force=off     → without force device: the doctor taps the screen to start/stop each repetition
//   ?session=<id>&patient=<id>&name=<test name> → where results are saved (see app/mrc/actions.ts).
//     Nothing is written until the first repetition, so these travel with the test.
export type MrcTestOptions = { sequence: boolean; manual: boolean; session?: SessionDraft };

export const mrcTestHref = (testId: string, { sequence, manual, session }: MrcTestOptions): string => {
	const params = new URLSearchParams();
	if (sequence) params.set("mode", "sequence");
	if (manual) params.set("force", "off");
	if (session) {
		params.set("session", session.id);
		params.set("patient", session.patientId);
		params.set("name", session.name);
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
	return { id: session, patientId: patient, name, mode: manual ? "manual" : "force", sequence };
};

// Results page of a session.
export const mrcSessionHref = (sessionId: string): string => `/mrc/session/${sessionId}`;
