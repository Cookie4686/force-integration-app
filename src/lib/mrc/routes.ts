// URL for one MRC test. Query params:
//   ?mode=sequence → part of the full test (moves on to the next test)
//   ?force=off     → without force device: the doctor taps the screen to start/stop each repetition
export type MrcTestOptions = { sequence: boolean; manual: boolean };

export const mrcTestHref = (testId: string, { sequence, manual }: MrcTestOptions): string => {
	const params = new URLSearchParams();
	if (sequence) params.set("mode", "sequence");
	if (manual) params.set("force", "off");
	const query = params.toString();
	return `/mrc/${testId}${query ? `?${query}` : ""}`;
};
