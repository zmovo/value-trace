import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, "static"), dist, { recursive: true });

const entries = [
  ["service-worker", "src/background/service-worker.ts"],
  ["content", "src/content/content.ts"],
  ["page-hook", "src/content/page-hook.ts"],
  ["devtools", "src/devtools/devtools.ts"],
  ["panel", "src/panel/panel.ts"],
  ["popup", "src/popup/popup.ts"],
];

for (const [name, entry] of entries) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    build: {
      emptyOutDir: false,
      outDir: "dist",
      sourcemap: process.env.STORE !== "1",
      minify: false,
      lib: {
        entry: resolve(root, entry),
        name: name.replace(/[^a-zA-Z]/g, "_"),
        formats: ["iife"],
        fileName: () => `${name}.js`,
      },
    },
  });
  console.log(`[API Source] built ${name}.js`);
}

console.log("[API Source] extension ready in dist/");
