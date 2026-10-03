// Minimal types for js-aruco2 (the package ships none). Only the parts used here.
// https://github.com/damianofalcioni/js-aruco2

declare module "js-aruco2" {
	export namespace AR {
		type Point = { x: number; y: number };

		interface Marker {
			id: number;
			// 4 corners in pixels of the analysed image, clockwise.
			corners: Point[];
			hammingDistance: number;
		}

		class Detector {
			constructor(config?: { dictionaryName?: string; maxHammingDistance?: number });
			detect(image: { width: number; height: number; data: Uint8ClampedArray }): Marker[];
		}

		class Dictionary {
			constructor(dictionaryName: string);
			codeList: string[];
			generateSVG(id: number): string;
		}
	}
}
