/*
 * Builds ../App-product.html by packing index.html (the product) into one standalone file.
 * Every <link rel="stylesheet"> and <script src> in index.html is replaced by the file's contents,
 * so App-product.html runs exactly the same code as index.html, just without needing the folder.
 * Run with:  node tools/build-product.js   (from inside "Actual build demo")
 */
"use strict";
const fs = require("fs");
const path = require("path");
const demo = path.join(__dirname, "..");
const out = path.join(demo, "..", "App-product.html");
const read = (p) => fs.readFileSync(path.join(demo, p), "utf8");
// Keep inlined code from closing the <script> tag early.
const safe = (code) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

let html = read("index.html");

// 1. Stylesheets → inline <style>
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => "<style>\n" + read(href) + "\n</style>");

// 2. All <script src> tags → one inline <script>, in the same order
const srcs = [];
html = html.replace(/<script src="([^"]+)"><\/script>\n?/g, (_, src) => { srcs.push(src); return srcs.length === 1 ? "@@SCRIPTS@@\n" : ""; });
const bundle = srcs.map((s) => "/* ----- " + s + " ----- */\n" + read(s)).join("\n\n");
html = html.replace("@@SCRIPTS@@", () => "<script>\n/* ===== App-product.html: generated from Actual build demo/index.html. Don't edit by hand. ===== */\n" + safe(bundle) + "\n</script>");

// 3. Inline code needs an inline-friendly security policy (still no network calls)
html = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">');
html = html.replace(/<!-- The product, built from[^>]*-->\n/, "<!-- Standalone build of \"Actual build demo/index.html\": the engine, sample data and UI are all inside this one file. -->\n");

fs.writeFileSync(out, html);
console.log("Wrote " + path.relative(process.cwd(), out) + " from index.html (" + srcs.length + " scripts, " + Math.round(html.length / 1024) + " KB)");
