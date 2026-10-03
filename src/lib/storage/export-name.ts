// File names for exported results. Shared by the export popup (client) and the
// export route (server), so the suggested name and the downloaded name match.

import type { Patient, Session } from "./types";

export type ExportFormat = "csv" | "json";

const MAX_NAME_LENGTH = 100;

// Default name, e.g. "mrc-6501234-2026-10-03" (HN, or "patient" when there is none).
export const defaultExportName = (session: Pick<Session, "startedAt">, patient: Pick<Patient, "hn"> | null): string =>
	`mrc-${(patient?.hn || "patient").replace(/[^\w-]/g, "_")}-${session.startedAt.slice(0, 10)}`;

// Make a user-typed name safe as a file name on Windows/macOS/Linux. Keeps Thai and
// other letters; removes characters files cannot contain, any path, and a typed
// .csv/.json extension (the right one is added on download). Empty → null.
export const cleanExportName = (input: string | null | undefined): string | null => {
	const name = String(input ?? "")
		.normalize("NFC")
		.replace(/\.(csv|json)$/i, "")
		.replace(/[<>:"/\\|?*]/g, "_")
		// Control characters (codes 0–31) are not allowed in file names either.
		.replace(/./gu, (char) => (char.charCodeAt(0) < 32 ? "_" : char))
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, MAX_NAME_LENGTH);
	return name === "" ? null : name;
};
