// Marker results in a camera-independent form, plus helpers shared by the
// marker worker, the overlay and the tool page.

// Marker set printed on the force device: 250 ids, very robust against misreads.
export const MARKER_DICTIONARY = "ARUCO_MIP_36h12";

// Number of marker ids in that dictionary (ids 0–249).
export const MARKER_COUNT = 250;

// Max wrong bits accepted when decoding a marker. The dictionary allows 11, which
// lets random texture decode as a (wrong) marker; clear real markers read with 0–2.
export const MARKER_MAX_HAMMING = 4;

// Side of the printed black square, in centimetres.
export const DEFAULT_MARKER_SIZE_CM = 5;

export type NormalizedPoint = { x: number; y: number };

export type DetectedMarker = {
	id: number;
	// 4 corners, clockwise, as fractions (0..1) of the video frame width/height.
	corners: NormalizedPoint[];
	// Marker centre = centre of the force device (the sticker sits at the device's centre line).
	center: NormalizedPoint;
	// Average side length in pixels of the full video frame (how big it looks on camera).
	sidePx: number;
};

export type MarkerFrame = {
	markers: DetectedMarker[];
	// Video frame size the markers refer to.
	width: number;
	height: number;
	detectMs: number;
	time: number;
	// Increases by 1 with every detection (to measure the detection rate).
	count: number;
};

// Convert raw detector output (pixels of an analysed image of size w×h, which may
// be downscaled from the video by `scale`) into DetectedMarker values.
export const toDetectedMarkers = (
	found: { id: number; corners: { x: number; y: number }[] }[],
	w: number,
	h: number,
	scale: number
): DetectedMarker[] =>
	found.map(({ id, corners }) => {
		let edges = 0;
		for (let i = 0; i < corners.length; i++) {
			const a = corners[i];
			const b = corners[(i + 1) % corners.length];
			edges += Math.hypot(a.x - b.x, a.y - b.y);
		}
		const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
		const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
		return {
			id,
			corners: corners.map((p) => ({ x: p.x / w, y: p.y / h })),
			center: { x: cx / w, y: cy / h },
			sidePx: edges / corners.length / scale,
		};
	});

// Pixels per centimetre at the marker's distance, from its known printed size.
export const pixelsPerCm = (marker: DetectedMarker, markerSizeCm: number): number => marker.sidePx / markerSizeCm;
