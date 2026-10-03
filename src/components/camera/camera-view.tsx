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

export default function CameraView({
	camera,
	mirrored = true,
	overlay,
	onScreenClick,
	children,
}: {
	camera: ReturnType<typeof useCamera>;
	mirrored?: boolean;
	// Drawn over the video inside the mirrored box (e.g. the pose skeleton).
	overlay?: React.ReactNode;
	// When set, the whole camera screen acts as a button (e.g. tap to start/stop a repetition).
	onScreenClick?: () => void;
	children?: React.ReactNode;
}) {
	const { videoRef, status, retry } = camera;
	const screen = status === "active" ? null : STATUS_SCREEN[status];
	const isClickable = onScreenClick !== undefined && status === "active";

	return (
		<div
			className={cn(
				"relative aspect-video w-full overflow-hidden rounded-xl bg-black select-none",
				isClickable && "focus-visible:ring-primary cursor-pointer outline-none focus-visible:ring-4"
			)}
			{...(isClickable && {
				role: "button",
				tabIndex: 0,
				onClick: onScreenClick,
				onKeyDown: (event: React.KeyboardEvent) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onScreenClick();
					}
				},
			})}
		>
			{/* Video + overlay canvas are mirrored together so drawn landmarks stay aligned. */}
			<div className={cn("absolute inset-0", mirrored && "-scale-x-100")}>
				<video className="h-full w-full object-contain" ref={videoRef} muted playsInline autoPlay />
				{status === "active" && overlay}
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
					{children}
				</>
			)}
		</div>
	);
}
