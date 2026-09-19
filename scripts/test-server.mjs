import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test-page");
const PORT = 3456;

const dashboard = {
  data: {
    entryCount: 66860,
    exitCount: 52113,
    occupancyRate: 0.632,
    revenue: 12350.5,
    compactVisitors: 1200,
  },
};

const report = {
  data: {
    total: 66860,
  },
};

const cache = {
  result: {
    count: 66860,
  },
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendJson(res, body, delayMs = 0) {
  const payload = JSON.stringify(body);
  const write = () => {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(payload);
  };
  if (delayMs > 0) {
    setTimeout(write, delayMs);
    return;
  }
  write();
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];

  if (url === "/mock/dashboard") {
    sendJson(res, dashboard, 80);
    return;
  }
  if (url === "/mock/report") {
    sendJson(res, report);
    return;
  }
  if (url === "/mock/cache") {
    sendJson(res, cache);
    return;
  }

  const relative = url === "/" ? "/index.html" : url;
  const filePath = path.normalize(path.join(root, relative));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mime[ext] ?? "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[API Source] Test page: http://localhost:${PORT}`);
});
