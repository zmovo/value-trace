import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const outDir = resolve(root, "store");
const zip = resolve(outDir, "value-trace.zip");

const build = spawnSync(process.execPath, [resolve(root, "scripts", "build.mjs")], {
  cwd: root,
  env: { ...process.env, STORE: "1" },
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

mkdirSync(outDir, { recursive: true });
if (existsSync(zip)) {
  unlinkSync(zip);
}

const packed = spawnSync(
  "powershell",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}'`],
  { cwd: root, stdio: "inherit" },
);
if (packed.status !== 0) {
  process.exit(packed.status ?? 1);
}

console.log(`[API Source] store zip ready: ${zip}`);
