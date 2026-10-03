// This is copied from the old project
// TODO: double check and cleanup this file

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Copy WASM assets ──────────────────────────────────────────────────────────
const srcDirs = ["node_modules/@mediapipe/tasks-vision/wasm"];
const destDir = "public/wasm";

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const srcDir of srcDirs) {
	if (fs.existsSync(srcDir)) {
		for (const file of fs.readdirSync(srcDir)) {
			fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
			copied++;
		}
	} else {
		console.warn(`[copy-wasm] source directory missing: ${srcDir}`);
	}
}
console.log(`[copy-wasm] prepared ${copied} WASM asset(s) in ${destDir}.`);

// ── Bundle workers with esbuild ───────────────────────────────────────────────
// Every *.worker.ts in these folders is bundled to public/workers/<name>.js (flat).
const workerSrcDirs = ["src/lib/mediapipe/workers", "src/lib/marker/workers"];
const workerDestDir = "public/workers";

if (!fs.existsSync(workerDestDir)) fs.mkdirSync(workerDestDir, { recursive: true });

const workerFiles = workerSrcDirs
	.filter((dir) => fs.existsSync(dir))
	.flatMap((dir) =>
		fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".worker.ts"))
			.map((f) => path.join(dir, f))
	);

if (workerFiles.length === 0) {
	console.warn("[copy-wasm] no worker files found in", workerSrcDirs.join(", "));
} else {
	const entryPoints = workerFiles.join(" ");
	try {
		execSync(
			`npx esbuild ${entryPoints} --bundle --format=esm --outdir=${workerDestDir} --entry-names=[name] --platform=browser --external:path --external:fs --external:os --log-level=warning`,
			{ stdio: "inherit" }
		);
		console.log(`[copy-wasm] bundled ${workerFiles.length} worker(s) to ${workerDestDir}.`);
	} catch (e) {
		console.error("[copy-wasm] worker bundling failed:", e.message);
		process.exit(1);
	}
}
