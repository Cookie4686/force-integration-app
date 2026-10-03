"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "requesting" | "active" | "denied" | "unavailable" | "error";

const toErrorStatus = (error: unknown): CameraStatus => {
	const name = error instanceof DOMException ? error.name : "";
	if (name === "NotAllowedError" || name === "SecurityError") return "denied";
	// No camera, or mediaDevices missing entirely (unsupported browser / insecure origin).
	if (name === "NotFoundError" || name === "OverconstrainedError" || !navigator.mediaDevices) return "unavailable";
	return "error";
};

// Requests the webcam on mount, streams it into `videoRef`, and releases it on
// unmount. `retry` re-asks for permission (e.g. after the user unblocks it).
// `resolution`: preferred frame size; the browser picks the closest the camera supports.
export default function useCamera(resolution: { width: number; height: number } = { width: 1280, height: 720 }) {
	const { width, height } = resolution;
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	// Bumped on every start/stop so a getUserMedia call that resolves after the
	// component unmounted (or React re-ran the effect) releases its stream.
	const attemptRef = useRef(0);
	const [status, setStatus] = useState<CameraStatus>("requesting");

	const stop = useCallback(() => {
		attemptRef.current++;
		streamRef.current?.getTracks().forEach((track) => track.stop());
		streamRef.current = null;
		if (videoRef.current !== null) videoRef.current.srcObject = null;
	}, []);

	// State is only set inside promise callbacks, so this is safe to call from an effect.
	const acquire = useCallback(() => {
		stop();
		const attempt = attemptRef.current;

		Promise.resolve()
			.then(() =>
				navigator.mediaDevices.getUserMedia({ video: { width: { ideal: width }, height: { ideal: height } } })
			)
			.then((stream) => {
				if (attempt !== attemptRef.current) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}
				streamRef.current = stream;
				if (videoRef.current !== null) {
					videoRef.current.srcObject = stream;
					videoRef.current.play().catch(() => {
						// autoplay is allowed for muted video; ignore an interrupted play()
					});
				}
				setStatus("active");
			})
			.catch((error: unknown) => {
				if (attempt === attemptRef.current) setStatus(toErrorStatus(error));
			});
	}, [stop, width, height]);

	const retry = useCallback(() => {
		setStatus("requesting");
		acquire();
	}, [acquire]);

	useEffect(() => {
		acquire();
		return stop;
	}, [acquire, stop]);

	return { videoRef, status, retry };
}
