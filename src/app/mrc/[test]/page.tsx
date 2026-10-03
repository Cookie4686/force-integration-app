import { notFound } from "next/navigation";

import { getMrcTest, MRC_TESTS } from "@/lib/mrc/joints";
import { readSessionDraft } from "@/lib/mrc/routes";
import { isValidId, readSession } from "@/lib/storage/files";

import JointTest from "./joint-test";

export function generateStaticParams() {
	return MRC_TESTS.map(({ id }) => ({ test: id }));
}

export default async function PageMRCTest({ params, searchParams }: PageProps<"/mrc/[test]">) {
	const test = getMrcTest((await params).test);
	if (!test) notFound();

	const query = await searchParams;
	// `?mode=sequence` → part of the full test; otherwise a single test.
	const isSequence = query.mode === "sequence";
	// `?force=off` → without force device; the doctor taps the screen to start/stop repetitions.
	const isManual = query.force === "off";
	// `?session=…&patient=…&name=…` → where results are saved (from the start popup).
	const session = readSessionDraft(query, { sequence: isSequence, manual: isManual });
	const nextTest = isSequence ? MRC_TESTS[MRC_TESTS.indexOf(test) + 1] : undefined;

	// Continuing a record (or a refreshed page): pick up this test's reps already saved.
	const saved = session && isManual && isValidId(session.id) ? await readSession(session.id) : null;
	const savedRepDurationsMs =
		saved?.tests.find((item) => item.testId === test.id)?.reps.map((rep) => rep.durationMs) ?? [];

	// key: start a fresh session (and camera) when moving to the next test.
	return (
		<JointTest
			key={test.id}
			test={test}
			isSequence={isSequence}
			isManual={isManual}
			nextTest={nextTest}
			session={session}
			savedRepDurationsMs={savedRepDurationsMs}
		/>
	);
}
