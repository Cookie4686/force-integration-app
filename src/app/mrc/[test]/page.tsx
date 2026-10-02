import { notFound } from "next/navigation";

import { getMrcTest, MRC_TESTS } from "@/lib/mrc/joints";

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
	const nextTest = isSequence ? MRC_TESTS[MRC_TESTS.indexOf(test) + 1] : undefined;

	// key: start a fresh session (and camera) when moving to the next test.
	return <JointTest key={test.id} test={test} isSequence={isSequence} isManual={isManual} nextTest={nextTest} />;
}
