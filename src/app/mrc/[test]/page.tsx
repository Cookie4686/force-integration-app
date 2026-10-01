import { notFound } from "next/navigation";

import { getMrcJoint, MRC_JOINTS } from "@/lib/mrc/joints";

import JointTest from "./joint-test";

export function generateStaticParams() {
	return MRC_JOINTS.map(({ id }) => ({ joint: id }));
}

export default async function PageMRCJoint({ params, searchParams }: PageProps<"/mrc/[joint]">) {
	const joint = getMrcJoint((await params).joint);
	if (!joint) notFound();

	// `?mode=sequence` → part of the full test; otherwise a single joint test.
	const isSequence = (await searchParams).mode === "sequence";
	const nextJoint = isSequence ? MRC_JOINTS[MRC_JOINTS.indexOf(joint) + 1] : undefined;

	// key: start a fresh session (and camera) when moving to the next joint.
	return <JointTest key={joint.id} joint={joint} isSequence={isSequence} nextJoint={nextJoint} />;
}
