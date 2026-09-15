"use client";

import { PoseLandmarkerOptions } from "@mediapipe/tasks-vision";
import { useEffect, useState } from "react";

import useDebounce from "@/hooks/use-debounce";
import useMediapipePose from "@/hooks/use-mediapipe-pose";

import PageToolPoseSectionConfig from "./config-section";
import PageToolPoseSectionImage from "./image-section";

const initOptions: PoseLandmarkerOptions = {
	baseOptions: {
		modelAssetPath: "/pose/model/pose_landmarker_lite.task",
		delegate: "GPU",
	},
	runningMode: "IMAGE",
	numPoses: 4,
	outputSegmentationMasks: false,
};

export default function PageToolPose() {
	const mediapipePose = useMediapipePose(initOptions);
	const { modelStatus } = mediapipePose.states;
	const { updateOptions } = mediapipePose.actions;

	const [imageFile, setImageFile] = useState<File | null>(null);

	const [options, setOptions] = useState(initOptions);
	const debouncedOptions = useDebounce(options, 500);

	useEffect(() => {
		updateOptions(debouncedOptions);

		// update model option
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedOptions]);

	return (
		<div className="flex justify-between p-2">
			<div className="rounded border p-2">
				<PageToolPoseSectionImage mediapipePose={mediapipePose} imageFile={imageFile} />
			</div>
			<div className="w-xs rounded border p-2">
				<PageToolPoseSectionConfig
					initOption={initOptions}
					setOptionAction={setOptions}
					setImageFileAction={setImageFile}
					modelStatus={modelStatus}
				/>
			</div>
		</div>
	);
}
