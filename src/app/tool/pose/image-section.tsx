"use client";

import { cn } from "cn";
import { CrosshairIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import useMediapipePose from "@/hooks/use-mediapipe-pose";

import PoseModelImage from "../../../../public/pose/four-people.jpeg";

export default function PageToolPoseSectionImage({
	mediapipePose,
	imageFile,
}: {
	mediapipePose: ReturnType<typeof useMediapipePose>;
	imageFile: File | null;
}) {
	const { refs, states, handlers } = mediapipePose;
	const { imageRef, canvasRef } = refs;
	const { modelStatus, focusPoint, focusPointRadius } = states;
	const { handleCanvasClick, handleClearFocusPoint, handleOnImageLoad } = handlers;
	const [isShowSkeletal, setIsShowSkeletal] = useState(true);
	const [isShowFocusPoint, setIsShowFocusPoint] = useState(true);

	return (
		<div className="relative flex h-full w-full flex-col items-center justify-center p-2">
			<div className="relative inline-block max-w-full">
				<Image
					className="block max-h-196 w-auto max-w-full rounded object-contain"
					loading="eager"
					width={1024}
					height={1024}
					src={imageFile ? URL.createObjectURL(imageFile) : PoseModelImage}
					onLoad={handleOnImageLoad}
					alt="Pose Model Image"
					ref={imageRef}
				/>
				<canvas
					className={cn(
						"absolute top-0 left-0 h-full w-full rounded",
						(modelStatus.state !== "idle" || !isShowSkeletal) && "opacity-0"
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
				<div className="pointer-events-none absolute right-4 bottom-4 flex flex-col gap-2">
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
		</div>
	);
}
