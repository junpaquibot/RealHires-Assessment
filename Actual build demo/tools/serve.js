/*
 * Optional local web server (no dependencies). The app works fine by double-clicking index.html;
 * this is only for previewing over http://localhost.  Run with:  node tools/serve.js  [port] [folder]
 * It serves this folder read-only, binds to 127.0.0.1 only, and refuses paths outside the folder.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
// Serves "Actual build demo/" by default. Pass a folder as the 2nd argument to serve something else.
const root = path.resolve(process.argv[3] || path.join(__dirname, ".."));
const port = Number(process.argv[2]) || 8765;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(root, "." + rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}).listen(port, "127.0.0.1", () => console.log("HireIntercept on http://127.0.0.1:" + port + "/  (Ctrl+C to stop)"));
