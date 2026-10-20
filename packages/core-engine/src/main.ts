import { createEngineCore } from "./engine-core.js";
import { doctor } from "./doctor.js";

const log = (msg: string) => console.log(`[core-engine] ${msg}`);

const core = await createEngineCore({ log, enableWatcher: true });
const report = await doctor(core.config);
if (!report.ok) {
  log("toolchain check FAILED:");
  report.problems.forEach((p) => log(`  - ${p}`));
} else {
  log("toolchain ok — ffmpeg, chromium, sfx bank, runtime dist all present");
}

log(`EngineCore initialized in-memory (storage: ${core.paths.storageDir}, vault: ${core.paths.vaultDir})`);
