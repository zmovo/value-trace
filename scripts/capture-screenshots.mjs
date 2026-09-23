import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createReadStream, statSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = resolve(root, "store", "screenshots");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
];
const chrome = chromeCandidates.find((path) => existsSync(path));
if (!chrome) {
  console.error("Chrome not found. Install Chrome to capture store screenshots.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || "/").split("?")[0].replace(/^\//, "")) || "inspect.html";
  const file = resolve(shots, name);
  if (!file.startsWith(shots) || !existsSync(file)) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  createReadStream(file).pipe(res);
});

await new Promise((resolveListen) => server.listen(8765, "127.0.0.1", resolveListen));

const captures = [
  ["cover.html", "cover-1280x800.png", "1280,800"],
  ["inspect.html", "inspect-1280x800.png", "1280,800"],
  ["popup.html", "popup-1280x800.png", "1280,800"],
  ["tile.html", "tile-440x280.png", "440,280"],
];

for (const [page, out, size] of captures) {
  const dest = resolve(shots, out);
  const result = spawnSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${size}`,
      `--screenshot=${dest}`,
      `http://127.0.0.1:8765/${page}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    server.close();
    process.exit(result.status ?? 1);
  }
  console.log(`[API Source] ${out} (${statSync(dest).size} bytes)`);
}

server.close();
console.log("[API Source] store screenshots ready");
