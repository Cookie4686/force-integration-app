// BLE protocol of the HHD (hand-held dynamometer) force device.
// Source: docs/HHD_BLE_Device_Brief.txt — the firmware is fixed, so this must
// match it exactly. All multi-byte fields are little-endian.

// Web Bluetooth requires lowercase UUIDs.
export const HHD_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
export const HHD_CHAR = {
	force: "beb5483e-36e1-4688-b7f5-ea07361b26a8", // NOTIFY
	command: "beb5483f-36e1-4688-b7f5-ea07361b26a8", // WRITE (with response)
	status: "beb54840-36e1-4688-b7f5-ea07361b26a8", // READ, NOTIFY
	info: "beb54841-36e1-4688-b7f5-ea07361b26a8", // READ
} as const;

export const KG_TO_N = 9.80665;

// --- Force measurement (section 3) ---------------------------------------------

export type HhdSample = {
	seq: number;
	// ms since stream start, device clock. Build time series from this, never assume a rate.
	timestampMs: number;
	forceKg: number;
	// 0 = normal, 3 = overload/error
	status: number;
};

const SAMPLE_SIZE = 11;

// One notification = N × 11-byte samples, no header. Returns null for a corrupt packet.
export const parseForcePacket = (data: DataView): HhdSample[] | null => {
	if (data.byteLength === 0 || data.byteLength % SAMPLE_SIZE !== 0) return null;

	const samples: HhdSample[] = [];
	for (let offset = 0; offset < data.byteLength; offset += SAMPLE_SIZE) {
		samples.push({
			seq: data.getUint16(offset, true),
			timestampMs: data.getUint32(offset + 2, true),
			forceKg: data.getFloat32(offset + 6, true),
			status: data.getUint8(offset + 10),
		});
	}
	return samples;
};

// Number of samples lost between the previous and current sequence numbers (uint16, wraps).
export const countLostSamples = (lastSeq: number, seq: number): number => {
	const expected = (lastSeq + 1) & 0xffff;
	return (seq - expected) & 0xffff;
};

// --- Device status (section 4) ---------------------------------------------------

export const HHD_STATUS_CODE = {
	idle: 0x00,
	taring: 0x01,
	streaming: 0x02,
	error: 0x03,
	lowBattery: 0x04,
} as const;

export const HHD_STATUS_LABEL: Record<number, string> = {
	0x00: "Idle",
	0x01: "Taring",
	0x02: "Streaming",
	0x03: "Error",
	0x04: "Low battery",
};

export const HHD_ERROR_LABEL: Record<number, string> = {
	0x00: "None",
	0x01: "HX711 not responding",
	0x02: "Tare timeout",
	0x03: "ADC overflow / calibration read failure",
};

export type HhdStatus = { code: number; errorCode: number; batteryPct: number };

export const parseStatus = (data: DataView): HhdStatus | null => {
	if (data.byteLength < 3) return null;
	return { code: data.getUint8(0), errorCode: data.getUint8(1), batteryPct: data.getUint8(2) };
};

// --- Device info (section 5) -----------------------------------------------------

export type HhdInfo = { name: string; firmware: string; batteryPct: number };

export const parseInfo = (data: DataView): HhdInfo | null => {
	if (data.byteLength < 21) return null;
	const nameBytes = new Uint8Array(data.buffer, data.byteOffset, 16).filter((byte) => byte !== 0);
	return {
		name: new TextDecoder().decode(nameBytes),
		firmware: `v${data.getUint8(16)}.${data.getUint8(17)}.${data.getUint8(18)}`,
		batteryPct: data.getUint8(20),
	};
};

// --- Device command (section 6) --------------------------------------------------

export const HHD_COMMAND = {
	tare: 0x01,
	startStream: 0x02,
	stopStream: 0x03,
	getStatus: 0x04,
} as const;

// [command_id, payload_len, ...payload]
export const buildCommand = (id: number, payload: number[] = []): Uint8Array<ArrayBuffer> =>
	new Uint8Array([id, payload.length, ...payload]);
