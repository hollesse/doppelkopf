// Minimal static server for the tests: serves _site/ under the same path prefix as GitHub Pages.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import site from "../src/_data/site.js";

const ROOT = new URL("../_site/", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8080);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (!pathname.startsWith(site.pathPrefix)) {
    res.writeHead(404).end("Not found");
    return;
  }
  let file = join(ROOT, normalize(decodeURIComponent(pathname.slice(site.pathPrefix.length))));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`Serving _site at http://localhost:${PORT}${site.pathPrefix}`));
