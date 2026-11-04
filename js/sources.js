/*
 * sources.js: the retrieval layer. It gets raw CSV text, either the embedded sample or a file the user imports.
 * In production this becomes the Apollo / job-feed sync and the Finally Staff candidate API.
 */
(function (HI) {
  "use strict";

  var REQUIRED = {
    jobs: ["posting_id", "company", "domain", "industry", "title", "required_skills", "remote_policy",
           "us_hours_required", "posted_days_ago", "repost_count"],
    candidates: ["candidate_id", "role_specialty", "skills", "us_hours_available", "available_now"],
    events: ["event_id", "posting_id", "variant", "step", "event_type", "event_day"]
  };

  function loadSample() {
    var s = HI.sampleData;
    return {
      jobs: { text: s.jobs, name: "hireintercept_sample_jobs.csv", origin: "sample" },
      candidates: { text: s.candidates, name: "hireintercept_sample_candidates.csv", origin: "sample" },
      events: { text: s.events, name: "hireintercept_sample_events.csv", origin: "sample" }
    };
  }

  // Parse and check headers. A file missing required columns is rejected, not half-loaded.
  function parseKind(kind, text) {
    var parsed = HI.csv.parse(text);
    var missing = REQUIRED[kind].filter(function (h) { return parsed.headers.indexOf(h) < 0; });
    if (missing.length) {
      throw new Error("This doesn't look like a " + kind + " file. Missing column(s): " + missing.join(", "));
    }
    return parsed;
  }

  // Work out which kind of file was imported from its headers.
  function detectKind(text) {
    var headers = HI.csv.parse(String(text).split(/\r?\n/)[0] || "").headers;
    var kinds = Object.keys(REQUIRED).filter(function (k) {
      return REQUIRED[k].every(function (h) { return headers.indexOf(h) >= 0; });
    });
    return kinds[0] || null;
  }

  // Read a user-chosen file as text. Size is capped, and the content is only ever parsed, never run.
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > HI.rules.import.maxBytes) {
        reject(new Error(file.name + " is larger than 5 MB and was not loaded."));
        return;
      }
      if (!/\.(csv|txt)$/i.test(file.name)) {
        reject(new Error(file.name + " is not a .csv file."));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error("Could not read " + file.name)); };
      reader.readAsText(file);
    });
  }

  HI.sources = { REQUIRED: REQUIRED, loadSample: loadSample, parseKind: parseKind, detectKind: detectKind, readFile: readFile };
})(this.HI = this.HI || {});
