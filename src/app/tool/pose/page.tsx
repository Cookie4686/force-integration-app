"use client";

import { useEffect, useState } from "react";

import useDebounce from "@/hooks/use-debounce";
import useMediapipePose, { ModelOption } from "@/hooks/use-mediapipe-pose";

import PageToolPoseSectionConfig from "./config-section";
import PageToolPoseSectionImage from "./image-section";

const initOptions: ModelOption = {
	type: "lite",
	delegate: "GPU",
	runningMode: "IMAGE",
	numPoses: 2,
	outputSegmentationMasks: false,
};

export default function PageToolPose() {
	const mediapipePose = useMediapipePose(initOptions);
	const { updateOptions } = mediapipePose.actions;

	const [imageFile, setImageFile] = useState<File | null>(null);
	const [mode, setMode] = useState<ModelOption["runningMode"]>(initOptions.runningMode);

	const [options, setOptions] = useState(initOptions);
	const debouncedOptions = useDebounce(options, 500);

	useEffect(() => {
		updateOptions(debouncedOptions);

		// update model option on debounced option changes
	}, [updateOptions, debouncedOptions]);

	return (
		<div className="flex justify-between gap-2 p-2" style={{ height: "inherit" }}>
			<div className="w-full overflow-y-scroll rounded border p-2">
				{mode === "VIDEO" ?
					<p>WIP</p>
				:	<PageToolPoseSectionImage mediapipePose={mediapipePose} imageFile={imageFile} />}
			</div>
			<div className="w-xs overflow-y-scroll rounded border p-2">
				<PageToolPoseSectionConfig
					initOption={initOptions}
					mode={mode}
					setModeAction={setMode}
					setOptionAction={setOptions}
					setFileAction={setImageFile}
					mediapipePose={mediapipePose}
				/>
			</div>
		</div>
	);
}
