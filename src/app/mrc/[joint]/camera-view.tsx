"use client";

import { cn } from "cn";
import { Loader2Icon, RefreshCwIcon, ShieldAlertIcon, VideoOffIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import useCamera, { CameraStatus } from "@/hooks/use-camera";

const STATUS_SCREEN: Record<
	Exclude<CameraStatus, "active">,
	{ icon: typeof VideoOffIcon; title: string; hint: string }
> = {
	requesting: {
		icon: Loader2Icon,
		title: "Waiting for camera permission…",
		hint: "Click “Allow” when the browser asks to use your camera.",
	},
	denied: {
		icon: ShieldAlertIcon,
		title: "Camera access was blocked",
		hint: "Allow camera access from the icon in the address bar, then try again.",
	},
	unavailable: {
		icon: VideoOffIcon,
		title: "No camera found",
		hint: "Connect a camera and make sure no other app is using it.",
	},
	error: {
		icon: VideoOffIcon,
		title: "Could not start the camera",
		hint: "Close other apps that may be using the camera, then try again.",
	},
};

export default function CameraView({ mirrored = true, children }: { mirrored?: boolean; children?: React.ReactNode }) {
	const { videoRef, status, retry } = useCamera();
	const screen = status === "active" ? null : STATUS_SCREEN[status];

	return (
		<div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
			{/* Video + overlay canvas are mirrored together so drawn landmarks stay aligned. */}
			<div className={cn("absolute inset-0", mirrored && "-scale-x-100")}>
				<video className="h-full w-full object-contain" ref={videoRef} muted playsInline autoPlay />
				{/* Overlay for the skeleton — left empty until the pose model is connected. */}
				<canvas className="pointer-events-none absolute inset-0 h-full w-full" />
			</div>

			{screen && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
					<screen.icon className={cn("size-10", status === "requesting" && "animate-spin")} />
					<p className="text-lg font-semibold">{screen.title}</p>
					<p className="max-w-sm text-sm text-white/70">{screen.hint}</p>
					{status !== "requesting" && (
						<Button variant="secondary" onClick={retry}>
							<RefreshCwIcon />
							Try again
						</Button>
					)}
				</div>
			)}

			{status === "active" && (
				<>
					<Badge className="absolute top-3 left-3 bg-red-600 text-white">
						<span className="size-1.5 animate-pulse rounded-full bg-white" />
						LIVE
					</Badge>
					<Badge variant="secondary" className="absolute top-3 right-3 opacity-80">
						Pose model not connected
					</Badge>
					{children}
				</>
			)}
		</div>
	);
}
