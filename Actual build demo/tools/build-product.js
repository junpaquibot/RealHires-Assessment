/*
 * Builds ../../App-product.html: one standalone file with the engine, the sample data and the product UI.
 * The engine files are the same ones the Actual build demo uses, so both always give the same numbers.
 * Run with:  node tools/build-product.js   (from inside "Actual build demo")
 */
"use strict";
const fs = require("fs");
const path = require("path");
const demo = path.join(__dirname, "..");
const out = path.join(demo, "..", "App-product.html");

const ENGINE = ["rules", "csv", "sample-data", "sources", "normalize", "dedup", "eligibility", "matching", "scoring",
  "campaign", "assignment", "followups", "metrics", "outreach", "quality", "pipeline"];

const read = (p) => fs.readFileSync(path.join(demo, p), "utf8");
// Keep inlined code from closing the <script> tag early.
const safe = (code) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

const parts = [];
parts.push("/* ===== App-product.html: generated file ===== */");
ENGINE.forEach((f) => parts.push("/* ----- js/" + f + ".js ----- */\n" + read("js/" + f + ".js")));
parts.push("/* product keeps its own saved decisions, separate from the demo */\n(function (HI) { HI.storeKey = \"hireintercept-product-v1\"; })(this.HI = this.HI || {});");
["js/store.js", "js/ui.js", "product/product.js"].forEach((f) => parts.push("/* ----- " + f + " ----- */\n" + read(f)));

const html = read("product/product.template.html")
  .replace("/*{{CSS}}*/", () => read("product/product.css"))
  .replace("/*{{SCRIPTS}}*/", () => safe(parts.join("\n\n")));

fs.writeFileSync(out, html);
console.log("Wrote " + path.relative(process.cwd(), out) + " (" + Math.round(html.length / 1024) + " KB)");
