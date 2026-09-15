"use client";

import { cn } from "cn";
import { CrosshairIcon } from "lucide-react";
import Image from "next/image";

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
	const { modelStatus, focusPoint } = states;
	const { handleCanvasClick, handleClearFocusPoint, handleOnImageLoad } = handlers;

	return (
		<div className="relative flex w-full flex-col items-center justify-center p-2">
			<div className="relative inline-block max-w-full">
				<Image
					className="block max-h-128 w-auto max-w-full rounded object-contain"
					loading="eager"
					width={512}
					height={512}
					src={imageFile ? URL.createObjectURL(imageFile) : PoseModelImage}
					onLoad={handleOnImageLoad}
					alt="Pose Model Image"
					ref={imageRef}
				/>
				<canvas
					className={cn(
						"absolute top-0 left-0 h-full w-full rounded",
						modelStatus.state === "inference" && "invisible"
					)}
					ref={canvasRef}
					onClick={handleCanvasClick}
				/>
				{focusPoint && (
					<CrosshairIcon
						className="absolute -translate-1/2 stroke-white"
						size={24}
						style={{ left: focusPoint.x, top: focusPoint.y }}
					/>
				)}
				{focusPoint && (
					<Button className="absolute right-4 bottom-4" onClick={handleClearFocusPoint}>
						Clear Focus Point
					</Button>
				)}
			</div>
		</div>
	);
}
