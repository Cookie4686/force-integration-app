"use client";

import { SliderRootProps } from "@base-ui/react";
import { PoseLandmarkerOptions } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ModelStatus } from "@/hooks/use-mediapipe-pose";

export default function PageToolPoseSectionConfig({
	initOption,
	setOptionAction: setModelOptionAction,
	setImageFileAction: setFileAction,
	modelStatus,
}: {
	initOption: PoseLandmarkerOptions;
	setOptionAction: React.Dispatch<React.SetStateAction<PoseLandmarkerOptions>>;
	setImageFileAction: React.Dispatch<React.SetStateAction<File | null>>;
	modelStatus: ModelStatus;
}) {
	const [numPose, setNumPose] = useState(initOption.numPoses || 1);
	const [minDetect, setMinDetect] = useState(initOption.minPoseDetectionConfidence || 0.5);
	const [minPresence, setMinPresence] = useState(initOption.minPosePresenceConfidence || 0.5);
	const [minTracking, setMinTracking] = useState(initOption.minTrackingConfidence || 0.5);
	const [isDelegateGPU, setIsDelegateGPU] = useState(initOption.baseOptions?.delegate === "GPU");

	const inputRef = useRef<HTMLInputElement>(null);

	const onInputFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
		const file = e.target.files?.[0];
		if (file) {
			setFileAction(file);
		}
	};

	// TODO: might convert this use effect to something else
	useEffect(() => {
		setModelOptionAction({
			baseOptions: {
				modelAssetPath: "/pose/model/pose_landmarker_lite.task",
				delegate: isDelegateGPU ? "GPU" : "CPU",
			},
			numPoses: numPose,
			minPoseDetectionConfidence: minDetect,
			minPosePresenceConfidence: minPresence,
			minTrackingConfidence: minTracking,
			outputSegmentationMasks: false,
			runningMode: "IMAGE",
		});
	}, [numPose, minDetect, minPresence, minTracking, isDelegateGPU, setModelOptionAction]);

	return (
		<div className="flex flex-col gap-4">
			<Field>
				<FieldLabel htmlFor="config-slider-image">Image</FieldLabel>
				<Input
					className="cursor-pointer"
					id="config-slider-image"
					type="file"
					accept="image/*"
					ref={inputRef}
					onChange={onInputFileChange}
				/>
				<FieldDescription>Select an image to upload.</FieldDescription>
			</Field>
			<SliderControlled label="Num Poses" value={numPose} setValue={setNumPose} min={1} max={10} step={1} />
			<SliderControlled label="Min Detection Confidence" value={minDetect} setValue={setMinDetect} />
			<SliderControlled label="Min Presence Confidence" value={minPresence} setValue={setMinPresence} />
			<SliderControlled label="Min Tracking Confidence" value={minTracking} setValue={setMinTracking} />
			<div className="flex flex-col gap-3">
				<Label htmlFor="config-slider-delegate">Delegate</Label>
				<div className="flex items-center space-x-2">
					<Label htmlFor="config-slider-delegate">CPU</Label>
					<Switch
						id="config-slider-delegate"
						checked={isDelegateGPU}
						onCheckedChange={(value) => {
							setIsDelegateGPU(value);
						}}
					/>
					<Label htmlFor="config-slider-delegate">GPU</Label>
				</div>
			</div>
			<div>
				<p>
					{(() => {
						switch (modelStatus.state) {
							case "load":
								return "Model is loading";
							case "inference":
								return "Model is inferencing";
							case "error":
								return "Model encounter an error";
							case "idle":
								return modelStatus.inferenceTime ?
										`Inference Time: ${modelStatus.inferenceTime} ms`
									:	`Loading Time: ${modelStatus?.loadTime} ms`;
						}
					})()}
				</p>
			</div>
		</div>
	);
}

function SliderControlled({
	label,
	value,
	setValue,
	min = 0,
	max = 1,
	step = 0.01,
	...props
}: {
	label: string;
	value: number;
	setValue: React.Dispatch<React.SetStateAction<number>>;
} & Omit<SliderRootProps, "value">) {
	const sliderID = `config-slider-${label.toLowerCase().replaceAll(" ", "-")}`;

	return (
		<div className="flex w-full flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={sliderID}>{label}</Label>
				<span className="text-muted-foreground text-sm">{value}</span>
			</div>
			<Slider
				id={sliderID}
				value={value}
				onValueChange={(value) => setValue(value as number)}
				min={min}
				max={max}
				step={step}
				{...props}
			/>
		</div>
	);
}
