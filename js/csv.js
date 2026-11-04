/*
 * csv.js: a small CSV parser (RFC 4180: quoted fields, escaped quotes, commas and line breaks inside quotes).
 * No dependencies. It returns plain strings and never evaluates anything.
 */
(function (HI) {
  "use strict";

  function parse(text) {
    text = String(text || "").replace(/^﻿/, ""); // strip the byte-order mark Excel adds
    var rows = [], row = [], field = "", inQuotes = false, i = 0, c;
    while (i < text.length) {
      c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    // drop fully blank lines
    rows = rows.filter(function (r) { return r.some(function (v) { return v.trim() !== ""; }); });
    if (!rows.length) return { headers: [], records: [] };
    var headers = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, "_"); });
    var records = rows.slice(1).map(function (r, idx) {
      var o = { _line: idx + 2 };
      headers.forEach(function (h, j) { o[h] = r[j] === undefined ? "" : r[j]; });
      if (r.length !== headers.length) o._columnMismatch = r.length;
      return o;
    });
    return { headers: headers, records: records };
  }

  HI.csv = { parse: parse };
})(this.HI = this.HI || {});
