"use client";

import { SliderRootProps } from "@base-ui/react";
import { useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import useMediapipePose from "@/hooks/use-mediapipe-pose";
import { DEFAULT_PROCESSING_SETTINGS, PoseProcessingSettings } from "@/lib/pose/processing";

export default function PageToolPoseSectionProcessing({
	mediapipePose,
}: {
	mediapipePose: ReturnType<typeof useMediapipePose>;
}) {
	const { states, actions } = mediapipePose;
	const { poseReadout } = states;
	const { updateProcessingSettings } = actions;

	const [settings, setSettings] = useState<PoseProcessingSettings>(DEFAULT_PROCESSING_SETTINGS);

	// Push settings into the detection loop (cheap ref update, no worker reconfigure).
	useEffect(() => {
		updateProcessingSettings(settings);
	}, [settings, updateProcessingSettings]);

	return (
		<div className="flex flex-col gap-4">
			<Separator />
			<Label className="text-base font-semibold">Signal Processing</Label>

			{/* Confidence threshold */}
			<ToggleField
				label="Confidence Threshold"
				description="Hide landmarks below a visibility likelihood."
				checked={settings.confidenceThreshold.enabled}
				onCheckedChange={(enabled) =>
					setSettings((s) => ({ ...s, confidenceThreshold: { ...s.confidenceThreshold, enabled } }))
				}
			>
				<SliderRow
					label="Min Visibility"
					value={settings.confidenceThreshold.value}
					setValue={(value) =>
						setSettings((s) => ({ ...s, confidenceThreshold: { ...s.confidenceThreshold, value } }))
					}
				/>
			</ToggleField>

			{/* One Euro filter */}
			<ToggleField
				label="One Euro Filter"
				description="Adaptive smoothing: less lag on fast motion, more smoothing when still."
				checked={settings.oneEuro.enabled}
				onCheckedChange={(enabled) => setSettings((s) => ({ ...s, oneEuro: { ...s.oneEuro, enabled } }))}
			>
				<SliderRow
					label="Min Cutoff (Hz)"
					value={settings.oneEuro.minCutoff}
					setValue={(minCutoff) => setSettings((s) => ({ ...s, oneEuro: { ...s.oneEuro, minCutoff } }))}
					min={0.1}
					max={5}
					step={0.1}
				/>
				<SliderRow
					label="Beta"
					value={settings.oneEuro.beta}
					setValue={(beta) => setSettings((s) => ({ ...s, oneEuro: { ...s.oneEuro, beta } }))}
					min={0}
					max={0.5}
					step={0.005}
				/>
			</ToggleField>

			{/* Kalman filter */}
			<ToggleField
				label="Kalman Filter"
				description="Random-walk smoothing. Stacks after One Euro when both are on."
				checked={settings.kalman.enabled}
				onCheckedChange={(enabled) => setSettings((s) => ({ ...s, kalman: { ...s.kalman, enabled } }))}
			>
				<SliderRow
					label="Process Noise"
					value={settings.kalman.processNoise}
					setValue={(processNoise) => setSettings((s) => ({ ...s, kalman: { ...s.kalman, processNoise } }))}
					min={0.0001}
					max={0.1}
					step={0.0001}
				/>
				<SliderRow
					label="Measurement Noise"
					value={settings.kalman.measurementNoise}
					setValue={(measurementNoise) =>
						setSettings((s) => ({ ...s, kalman: { ...s.kalman, measurementNoise } }))
					}
					min={0.001}
					max={1}
					step={0.001}
				/>
			</ToggleField>

			{/* Pose-relative normalization */}
			<ToggleField
				label="Normalization"
				description="Hip-centered, torso-scaled coordinates (first pose). Data only — overlay unchanged."
				checked={settings.normalization.enabled}
				onCheckedChange={(enabled) =>
					setSettings((s) => ({ ...s, normalization: { ...s.normalization, enabled } }))
				}
			>
				{poseReadout ?
					<div className="bg-muted/40 flex flex-col gap-1 rounded border p-2 text-xs">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Torso scale</span>
							<span className="font-mono">{poseReadout.torsoScale.toFixed(4)}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Hip center (x, y)</span>
							<span className="font-mono">
								{poseReadout.hipCenter.x.toFixed(3)}, {poseReadout.hipCenter.y.toFixed(3)}
							</span>
						</div>
						<Separator className="my-1" />
						<div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 font-mono">
							<span className="text-muted-foreground">pt</span>
							<span className="text-muted-foreground text-right">x</span>
							<span className="text-muted-foreground text-right">y</span>
							<span className="text-muted-foreground text-right">z</span>
							{poseReadout.keyPoints.map((kp) => (
								<Row key={kp.label} kp={kp} />
							))}
						</div>
					</div>
				:	<p className="text-muted-foreground text-xs">Waiting for a detected pose…</p>}
			</ToggleField>
		</div>
	);
}

function Row({ kp }: { kp: { label: string; x: number; y: number; z: number } }) {
	return (
		<>
			<span className="text-muted-foreground">{kp.label}</span>
			<span className="text-right">{kp.x.toFixed(2)}</span>
			<span className="text-right">{kp.y.toFixed(2)}</span>
			<span className="text-right">{kp.z.toFixed(2)}</span>
		</>
	);
}

function ToggleField({
	label,
	description,
	checked,
	onCheckedChange,
	children,
}: {
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	children?: React.ReactNode;
}) {
	const id = `processing-${label.toLowerCase().replaceAll(" ", "-")}`;
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={id}>{label}</Label>
				<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
			</div>
			<p className="text-muted-foreground text-xs">{description}</p>
			{checked && children}
		</div>
	);
}

function SliderRow({
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
	const sliderID = `processing-slider-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

	return (
		<div className="flex w-full flex-col gap-2 pl-1">
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={sliderID} className="text-muted-foreground text-sm font-normal">
					{label}
				</Label>
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
