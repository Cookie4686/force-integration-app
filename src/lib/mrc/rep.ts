// Builds the saved result of one finished repetition. Shared by the realtime
// test (camera + device) and the video test (video file + force file).

import type { RepDevice, RepForce, RepResult } from "@/lib/storage/types";

import { DeviceRecording, summarizeDevice } from "./device";
import { getRepWarnings } from "./force";
import { MrcMeasure } from "./joints";
import { summarizeRep } from "./summary";

export const buildRepResult = ({
	index,
	startedAt,
	durationMs,
	measures,
	values,
	intervalMs,
	push,
}: {
	index: number;
	startedAt: string;
	durationMs: number;
	measures: MrcMeasure[];
	// Measure values recorded during the rep: [sample][measure].
	values: (number | null)[][];
	intervalMs: number;
	// Force-device mode: the push and the device position per sample.
	push?: {
		force: RepForce;
		deviceRows: DeviceRecording;
		// false: the device marker was never seen, so the position is assumed correct.
		markerSeen: boolean;
	};
}): RepResult => {
	const metrics = summarizeRep(measures, values);
	const rep: RepResult = {
		index,
		startedAt,
		durationMs: Math.round(durationMs),
		metrics,
		recording: { intervalMs, values },
	};
	if (!push) return rep;

	const device: RepDevice =
		push.markerSeen ? summarizeDevice(push.deviceRows) : { seenPct: 0, inPlacePct: null, assumed: true };
	return {
		...rep,
		recording: push.markerSeen ? { ...rep.recording, device: push.deviceRows } : rep.recording,
		force: push.force,
		device,
		warnings: getRepWarnings({ force: push.force, device, metrics }),
	};
};
