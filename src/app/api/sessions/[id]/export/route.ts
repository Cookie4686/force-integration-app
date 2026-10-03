import type { NextRequest } from "next/server";

import { buildSessionCsv } from "@/lib/storage/csv";
import { cleanExportName, defaultExportName } from "@/lib/storage/export-name";
import { isValidId, readPatients, readSession } from "@/lib/storage/files";

// GET /api/sessions/<id>/export?format=csv|json&name=<file name> → download one session's results.
// `name` is optional (without extension); the default is e.g. "mrc-6501234-2026-10-03".
export async function GET(request: NextRequest, ctx: RouteContext<"/api/sessions/[id]/export">) {
	const { id } = await ctx.params;
	if (!isValidId(id)) return new Response("Invalid session id.", { status: 400 });

	const session = await readSession(id);
	if (!session) return new Response("Session not found.", { status: 404 });
	const patient = (await readPatients()).find((item) => item.id === session.patientId) ?? null;

	const params = request.nextUrl.searchParams;
	const format = params.get("format") === "csv" ? "csv" : "json";
	const fileName = `${cleanExportName(params.get("name")) ?? defaultExportName(session, patient)}.${format}`;
	// Plain-ASCII fallback for old clients + the UTF-8 name (RFC 6266) so Thai names survive.
	const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");

	const body = format === "csv" ? buildSessionCsv(session, patient) : JSON.stringify({ patient, session }, null, 2);
	return new Response(body, {
		headers: {
			"Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
			"Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
			"Cache-Control": "no-store",
		},
	});
}
