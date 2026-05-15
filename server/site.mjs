/**
 * Production static host + Pump.fun API proxy.
 * Run: npm run build && npm start
 * Serves ./dist and forwards GET /pump-api/* → https://frontend-api-v3.pump.fun with pump.fun headers.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");
const PUMP_ORIGIN = "https://frontend-api-v3.pump.fun";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function resolveStaticFile(root, pathname) {
  const raw = decodeURIComponent((pathname || "/").split("?")[0] || "/");
  if (raw.includes("..")) return null;
  const rel = raw === "/" || raw === "" ? "index.html" : raw.replace(/^\/+/, "");
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

async function proxyPump(req, res, url) {
  const suffix = url.pathname.replace(/^\/pump-api/, "") || "/";
  const target = `${PUMP_ORIGIN}${suffix}${url.search}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        origin: "https://pump.fun",
        referer: "https://pump.fun/",
        accept: req.headers.accept || "application/json",
        "user-agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 (compatible; OuroborosStatic/1.0; +https://pump.fun)",
      },
    });
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": ct,
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Pump.fun proxy error");
  }
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=3600" });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/pump-api")) {
    return proxyPump(req, res, url);
  }

  const filePath = resolveStaticFile(DIST, url.pathname);
  if (!filePath) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, st) => {
    if (!err && st.isFile()) {
      return sendFile(res, filePath);
    }
    const indexHtml = path.join(DIST, "index.html");
    fs.stat(indexHtml, (e2, st2) => {
      if (e2 || !st2.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("Run npm run build first (dist/ missing).");
      }
      sendFile(res, indexHtml);
    });
  });
});

const PORT = Number(process.env.PORT) || 4173;
server.listen(PORT, () => {
  console.log(`Ouroboros: http://localhost:${PORT}/  (dist + /pump-api → Pump.fun)`);
});
