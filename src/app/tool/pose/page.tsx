"use client";

import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import useMediapipePose from "@/hooks/use-mediapipe-pose";

import PageMrcSectionImage from "./image-section";

export default function PageToolPose() {
	const mediapipePose = useMediapipePose({
		baseOptions: {
			modelAssetPath: "/pose/model/pose_landmarker_lite.task",
			delegate: "GPU",
		},
		runningMode: "IMAGE",
		numPoses: 4,
		outputSegmentationMasks: false,
	});

	const inputRef = useRef<HTMLInputElement>(null);
	const [file, setFile] = useState<File | null>(null);

	const onInputFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
		const file = e.target.files?.[0];
		if (file) {
			setFile(file);
		}
	};

	return (
		<div className="rounded border p-2">
			<PageMrcSectionImage mediapipePose={mediapipePose} imageFile={file} />
			<Input className="cursor-pointer" onChange={onInputFileChange} type="file" accept="image/*" ref={inputRef} />
		</div>
	);
}
