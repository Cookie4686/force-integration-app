"use client";

import { cn } from "cn";
import { CrosshairIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import useMediapipePose from "@/hooks/use-mediapipe-pose";

export default function PageToolPoseSectionVideo({
	mediapipePose,
	videoFile,
}: {
	mediapipePose: ReturnType<typeof useMediapipePose>;
	videoFile: File | null;
}) {
	const { refs, states, actions, handlers } = mediapipePose;
	const { videoRef, canvasRef } = refs;
	const { focusPoint, focusPointRadius, isWebcamActive } = states;
	const { startVideoDetection, stopVideoDetection, stopCamera } = actions;
	const { handleCanvasClick, handleClearFocusPoint, handleVideoLoadedMetadata } = handlers;

	const [isShowSkeletal, setIsShowSkeletal] = useState(true);
	const [isShowFocusPoint, setIsShowFocusPoint] = useState(true);
	// When off, the overlay canvas lets clicks through to the native video controls
	// (play / pause / seek). When on, the canvas captures clicks to set a focus point.
	const [isFocusMode, setIsFocusMode] = useState(false);

	const hasSource = isWebcamActive || videoFile !== null;

	// Run the detection loop for as long as the video section is mounted.
	useEffect(() => {
		startVideoDetection();
		return () => stopVideoDetection();
	}, [startVideoDetection, stopVideoDetection]);

	// Release the camera when leaving the video section.
	useEffect(() => {
		return () => stopCamera();
	}, [stopCamera]);

	// Point the <video> element at the uploaded file (the webcam manages its own srcObject).
	useEffect(() => {
		const video = videoRef.current;
		if (video === null || isWebcamActive) return;

		if (videoFile !== null) {
			const url = URL.createObjectURL(videoFile);
			video.src = url;
			video.load();
			return () => URL.revokeObjectURL(url);
		}

		video.removeAttribute("src");
		video.load();
	}, [videoRef, videoFile, isWebcamActive]);

	return (
		<div className="relative flex h-full w-full flex-col items-center justify-center p-2">
			<div className={cn("relative inline-block max-w-full", !hasSource && "hidden")}>
				<video
					className="block max-h-196 w-auto max-w-full rounded object-contain"
					ref={videoRef}
					controls={!isWebcamActive && videoFile !== null}
					muted
					playsInline
					autoPlay={isWebcamActive}
					onLoadedMetadata={handleVideoLoadedMetadata}
				/>
				<canvas
					className={cn(
						"absolute top-0 left-0 h-full w-full rounded",
						!isShowSkeletal && "opacity-0",
						isFocusMode ? "cursor-crosshair" : "pointer-events-none"
					)}
					ref={canvasRef}
					onClick={handleCanvasClick}
				/>
				{focusPoint && isShowFocusPoint && (
					<div
						className="pointer-events-none absolute flex -translate-1/2 items-center justify-center rounded-full border border-white"
						style={{
							width: focusPointRadius * 2,
							height: focusPointRadius * 2,
							left: focusPoint.x,
							top: focusPoint.y,
						}}
					>
						<CrosshairIcon className="stroke-white" size={24} />
					</div>
				)}
				<div className="pointer-events-none absolute right-4 bottom-16 flex flex-col gap-2">
					<Button
						className="pointer-events-auto"
						variant={isFocusMode ? "default" : "secondary"}
						onClick={() => {
							setIsFocusMode((prev) => !prev);
						}}
					>
						{isFocusMode ? "Done Selecting" : "Select Focus Point"}
					</Button>
					{focusPoint && (
						<Button className="pointer-events-auto" onClick={handleClearFocusPoint}>
							Clear Focus Point
						</Button>
					)}
					{focusPoint && (
						<Button
							className="pointer-events-auto"
							onClick={() => {
								setIsShowFocusPoint((prev) => !prev);
							}}
						>
							{isShowFocusPoint ? "Hide" : "Show"} Focus Point
						</Button>
					)}
					<Button
						className="pointer-events-auto"
						onClick={() => {
							setIsShowSkeletal((prev) => !prev);
						}}
					>
						{isShowSkeletal ? "Hide" : "Show"} Skeletal
					</Button>
				</div>
			</div>
			{!hasSource && (
				<p className="text-muted-foreground text-sm">
					Upload a video clip or enable the webcam to begin pose detection.
				</p>
			)}
		</div>
	);
}
