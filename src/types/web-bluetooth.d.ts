// Minimal Web Bluetooth types (not included in TypeScript's DOM lib).
// Only the parts used by src/hooks/use-hhd.ts. Supported in Chrome / Edge.
// https://developer.mozilla.org/docs/Web/API/Web_Bluetooth_API

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
	readonly value?: DataView;
	readValue(): Promise<DataView>;
	writeValueWithResponse(value: BufferSource): Promise<void>;
	startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
	stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService {
	getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
	readonly connected: boolean;
	connect(): Promise<BluetoothRemoteGATTServer>;
	disconnect(): void;
	getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
	readonly id: string;
	readonly name?: string;
	readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRequestDeviceOptions {
	filters?: { services?: string[]; name?: string; namePrefix?: string }[];
	optionalServices?: string[];
	acceptAllDevices?: boolean;
}

interface Bluetooth {
	getAvailability(): Promise<boolean>;
	requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
}

interface Navigator {
	readonly bluetooth?: Bluetooth;
}
