"use client";

import { CrosshairIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import useMediapipePose, { FocusPoint } from "@/hooks/use-mediapipe-pose";

import PoseModelImage from "../../../../public/pose/four-people.jpeg";

export default function PageMrcSectionImage({
	mediapipePose,
	imageFile,
}: {
	mediapipePose: ReturnType<typeof useMediapipePose>;
	imageFile: File | null;
}) {
	const { imageRef, canvasRef, drawSkeletal } = mediapipePose;

	const clickCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);

	const handleCanvasClick: React.MouseEventHandler<HTMLCanvasElement> = (event) => {
		if (clickCanvasRef.current === null || imageRef.current === null) return;

		const canvas = clickCanvasRef.current;

		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		setFocusPoint({ x, y });
	};

	useEffect(() => {
		drawSkeletal(focusPoint);

		// TODO: update on model config, focus point change
	}, [drawSkeletal, focusPoint]);

	return (
		<div className="relative flex w-full flex-col items-center justify-center p-2">
			<div className="relative inline-block max-w-full">
				<Image
					className="block max-h-128 w-auto max-w-full rounded object-contain"
					width={512}
					height={512}
					src={imageFile ? URL.createObjectURL(imageFile) : PoseModelImage}
					onLoad={async () => {
						await drawSkeletal(focusPoint);
					}}
					alt="Pose Model Image"
					ref={imageRef}
				/>
				<canvas className={"pointer-events-none absolute top-0 left-0 h-full w-full rounded"} ref={canvasRef} />
				<canvas
					className="absolute top-0 left-0 h-full w-full rounded"
					ref={clickCanvasRef}
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
					<Button className="absolute right-4 bottom-4" onClick={() => setFocusPoint(null)}>
						Clear Focus Point
					</Button>
				)}
			</div>
		</div>
	);
}
