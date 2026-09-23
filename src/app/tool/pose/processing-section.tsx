"use client";

import { SliderRootProps } from "@base-ui/react";

import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PoseProcessingSettings } from "@/lib/pose/processing";

// Controlled processing controls. The coordinate-display block is shown for both
// image and video; the temporal filters (Confidence / One Euro / Kalman) only
// make sense for a video stream, so they are gated behind `showFilters`.
export default function PageToolPoseSectionProcessing({
	settings,
	setSettings,
	showFilters,
}: {
	settings: PoseProcessingSettings;
	setSettings: React.Dispatch<React.SetStateAction<PoseProcessingSettings>>;
	showFilters: boolean;
}) {
	return (
		<div className="flex flex-col gap-4">
			<Separator />
			<Label className="text-base font-semibold">Coordinate Display</Label>
			<p className="text-muted-foreground text-xs">
				Overlay each landmark&apos;s coordinates on the {showFilters ? "video" : "image"}.
			</p>

			<SwitchRow
				label="Show X"
				checked={settings.labels.showX}
				onCheckedChange={(showX) => setSettings((s) => ({ ...s, labels: { ...s.labels, showX } }))}
			/>
			<SwitchRow
				label="Show Y"
				checked={settings.labels.showY}
				onCheckedChange={(showY) => setSettings((s) => ({ ...s, labels: { ...s.labels, showY } }))}
			/>
			<SwitchRow
				label="Show Z"
				checked={settings.labels.showZ}
				onCheckedChange={(showZ) => setSettings((s) => ({ ...s, labels: { ...s.labels, showZ } }))}
			/>
			<div className="flex items-center justify-between gap-2">
				<div className="flex flex-col">
					<Label htmlFor="coord-normalized">Normalize (0–1)</Label>
					<span className="text-muted-foreground text-xs">
						{settings.normalized ? "Values shown as 0–1 of the frame" : "Values shown as raw pixels"}
					</span>
				</div>
				<Switch
					id="coord-normalized"
					checked={settings.normalized}
					onCheckedChange={(normalized) => setSettings((s) => ({ ...s, normalized }))}
				/>
			</div>

			{showFilters && (
				<>
					<Separator />
					<Label className="text-base font-semibold">Signal Processing</Label>

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
				</>
			)}
		</div>
	);
}

function SwitchRow({
	label,
	checked,
	onCheckedChange,
}: {
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	const id = `coord-${label.toLowerCase().replaceAll(" ", "-")}`;
	return (
		<div className="flex items-center justify-between gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
		</div>
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
