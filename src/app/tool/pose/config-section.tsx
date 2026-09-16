"use client";

import { SliderRootProps } from "@base-ui/react";
import { useEffect, useRef, useState } from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import useMediapipePose, { ModelOption } from "@/hooks/use-mediapipe-pose";

const MODEL_TYPE_ITEMS: { value: ModelOption["type"]; label: string }[] = [
	{ value: "lite", label: "Pose Landmarker Lite" },
	{ value: "full", label: "Pose Landmarker Full" },
	{ value: "heavy", label: "Pose Landmarker Heavy" },
];

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PageToolPoseSectionConfig({
	initOption,
	mode,
	setModeAction,
	setOptionAction,
	setFileAction: setFileAction,
	mediapipePose,
}: {
	initOption: ModelOption;
	mode: ModelOption["runningMode"];
	setModeAction: React.Dispatch<React.SetStateAction<ModelOption["runningMode"]>>;
	setOptionAction: React.Dispatch<React.SetStateAction<ModelOption>>;
	setFileAction: React.Dispatch<React.SetStateAction<File | null>>;
	mediapipePose: ReturnType<typeof useMediapipePose>;
}) {
	const { states, actions } = mediapipePose;
	const { focusPointRadius, maxFocusPointRadius, modelStatus } = states;
	const { updateFocusPointRadius } = actions;

	const [type, setType] = useState(initOption.type);
	const [numPose, setNumPose] = useState(initOption.numPoses || 1);
	const [minDetect, setMinDetect] = useState(initOption.minPoseDetectionConfidence || 0.5);
	const [minPresence, setMinPresence] = useState(initOption.minPosePresenceConfidence || 0.5);
	const [minTracking, setMinTracking] = useState(initOption.minTrackingConfidence || 0.5);
	const [isDelegateGPU, setIsDelegateGPU] = useState(initOption.delegate === "GPU");

	const inputRef = useRef<HTMLInputElement>(null);

	const onInputFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
		const file = e.target.files?.[0];
		if (file) {
			setFileAction(file);
		}
	};

	// TODO: might convert this use effect to something else
	useEffect(() => {
		setOptionAction({
			type,
			delegate: isDelegateGPU ? "GPU" : "CPU",
			numPoses: numPose,
			minPoseDetectionConfidence: minDetect,
			minPosePresenceConfidence: minPresence,
			minTrackingConfidence: minTracking,
			outputSegmentationMasks: false,
			runningMode: "IMAGE",
		});
	}, [type, numPose, minDetect, minPresence, minTracking, isDelegateGPU, setOptionAction]);

	return (
		<div className="flex flex-col gap-4">
			<Tabs
				defaultValue="IMAGE"
				value={mode}
				onValueChange={(value) => {
					setModeAction(value);
				}}
			>
				<TabsList>
					<TabsTrigger value="IMAGE">Image</TabsTrigger>
					<TabsTrigger value="VIDEO">Video</TabsTrigger>
				</TabsList>
				<TabsContent value="IMAGE">
					<Field>
						<FieldLabel htmlFor="config-slider-image">File Upload</FieldLabel>
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
				</TabsContent>
				<TabsContent value="VIDEO">
					<Field>
						<FieldLabel htmlFor="config-slider-video">File Upload</FieldLabel>
						<Input className="cursor-pointer" id="config-slider-video" type="file" accept="video/*" disabled />
						<FieldDescription>Select a video clip to upload. (WIP)</FieldDescription>
					</Field>
				</TabsContent>
			</Tabs>
			<Separator />
			<Field>
				<FieldLabel htmlFor="config-slider-type">Model Type</FieldLabel>
				<Select
					id="config-slider-type"
					items={MODEL_TYPE_ITEMS}
					value={type}
					onValueChange={(value) => {
						if (value) setType(value);
					}}
				>
					<SelectTrigger className="w-full max-w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent alignItemWithTrigger>
						<SelectGroup>
							<SelectLabel>Model Type</SelectLabel>
							{MODEL_TYPE_ITEMS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
			<SliderControlled label="Num Poses" value={numPose} setValue={setNumPose} min={1} max={10} step={1} />
			<SliderControlled label="Min Detection Confidence" value={minDetect} setValue={setMinDetect} />
			<SliderControlled label="Min Presence Confidence" value={minPresence} setValue={setMinPresence} />
			<SliderControlled label="Min Tracking Confidence" value={minTracking} setValue={setMinTracking} />
			<SliderControlled
				label="Focus Point Radius"
				value={focusPointRadius}
				setValue={(value) => {
					updateFocusPointRadius(value);
				}}
				min={16}
				max={maxFocusPointRadius}
				step={1}
			/>
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
	setValue: (value: number) => void;
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
