import { engineConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { startEngine } from "./server.js";

const config = engineConfig({ port: Number(process.env.PORT ?? 4000) });
const log = (msg: string) => console.log(`[core-engine] ${msg}`);

const report = await doctor(config);
if (!report.ok) {
  log("toolchain check FAILED:");
  report.problems.forEach((p) => log(`  - ${p}`));
} else {
  log("toolchain ok — ffmpeg, chromium, sfx bank, runtime dist all present");
}

await startEngine({ config, log }).catch((error) => {
  console.error("[core-engine] fatal:", error);
  process.exit(1);
});
