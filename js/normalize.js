/*
 * normalize.js: cleans raw CSV records into consistent objects and records every problem it finds.
 * It never guesses. Unrecognised values are flagged and treated cautiously later on
 * (e.g. an unknown remote policy goes to human check, and an unknown availability is never described as available).
 */
(function (HI) {
  "use strict";

  function clean(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }
  function lower(v) { return clean(v).toLowerCase(); }

  function yesNo(v) {
    var s = lower(v);
    if (["yes", "y", "true", "1"].indexOf(s) >= 0) return "yes";
    if (["no", "n", "false", "0"].indexOf(s) >= 0) return "no";
    return "unknown";
  }

  function num(v) {
    var s = clean(v).replace(/[$,\s]/g, "");
    if (s === "") return null;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function domain(v) {
    return lower(v).replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[\/?#]/)[0];
  }

  function skills(v) {
    var display = clean(v).split(/[;|]/).map(clean).filter(Boolean);
    return { display: display, keys: display.map(function (s) { return s.toLowerCase(); }) };
  }

  function roleKey(title) {
    return lower(title).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  function policy(v) {
    var s = clean(v).toUpperCase().replace(/[\s\-.]+/g, "_");
    if (s === "ON_SITE") s = "ONSITE";
    if (s === "U_S_ONLY" || s === "USONLY") s = "US_ONLY";
    return s;
  }

  function jobs(records) {
    var out = [], issues = [], seen = {};
    records.forEach(function (r) {
      var id = clean(r.posting_id);
      var where = "jobs line " + r._line + (id ? " (" + id + ")" : "");
      if (r._columnMismatch) issues.push({ level: "warn", where: where, text: "Row has " + r._columnMismatch + " columns; expected the header's count. Values may be shifted." });
      if (!id || !clean(r.domain) || !clean(r.title)) {
        issues.push({ level: "error", where: where, text: "Row skipped: posting_id, domain and title are required." });
        return;
      }
      if (seen[id]) { issues.push({ level: "error", where: where, text: "Row skipped: duplicate posting_id " + id + "." }); return; }
      seen[id] = true;

      var flags = [];
      var sk = skills(r.required_skills);
      var pol = policy(r.remote_policy);
      if (HI.rules.remotePolicies.indexOf(pol) < 0) flags.push("Unrecognised remote_policy \"" + clean(r.remote_policy) + "\"");
      var usHours = yesNo(r.us_hours_required);
      if (usHours === "unknown" && lower(r.us_hours_required) !== "unknown") flags.push("Unrecognised us_hours_required \"" + clean(r.us_hours_required) + "\": treated as unknown");
      var job = {
        posting_id: id,
        company: clean(r.company),
        domain: domain(r.domain),
        industry: clean(r.industry) || "(not given)",
        company_employees: num(r.company_employees),
        title: clean(r.title),
        role_key: roleKey(r.title),
        required_skills: sk.keys,
        required_skills_display: sk.display,
        remote_policy: pol,
        us_hours_required: usHours,
        posted_days_ago: num(r.posted_days_ago),
        repost_count: num(r.repost_count),
        salary_usd_per_year: num(r.salary_usd_per_year),
        notes: clean(r.notes),
        flags: flags,
        line: r._line
      };
      ["company_employees", "posted_days_ago", "repost_count", "salary_usd_per_year"].forEach(function (f) {
        if (typeof job[f] === "number" && isNaN(job[f])) { flags.push(f + " is not a number: ignored"); job[f] = null; }
      });
      if (!sk.keys.length) flags.push("No required skills listed");
      flags.forEach(function (t) { issues.push({ level: "warn", where: where, text: t }); });
      out.push(job);
    });
    return { items: out, issues: issues };
  }

  function candidates(records) {
    var out = [], issues = [], seen = {};
    records.forEach(function (r) {
      var id = clean(r.candidate_id);
      var where = "candidates line " + r._line + (id ? " (" + id + ")" : "");
      if (!id) { issues.push({ level: "error", where: where, text: "Row skipped: candidate_id is required." }); return; }
      if (seen[id]) { issues.push({ level: "error", where: where, text: "Row skipped: duplicate candidate_id." }); return; }
      seen[id] = true;
      var sk = skills(r.skills);
      var c = {
        candidate_id: id,
        role_specialty: clean(r.role_specialty),
        skills: sk.keys,
        skills_display: sk.display,
        us_hours_available: yesNo(r.us_hours_available),
        available_now: yesNo(r.available_now),
        flags: []
      };
      if (c.available_now === "unknown") c.flags.push("available_now not yes/no: treated as NOT available");
      if (c.us_hours_available === "unknown") c.flags.push("us_hours_available not yes/no: treated as NOT able to work U.S. hours");
      c.flags.forEach(function (t) { issues.push({ level: "warn", where: where, text: t }); });
      out.push(c);
    });
    return { items: out, issues: issues };
  }

  function events(records) {
    var out = [], issues = [], seen = {};
    records.forEach(function (r, idx) {
      var id = clean(r.event_id);
      var where = "events line " + r._line + (id ? " (" + id + ")" : "");
      var type = lower(r.event_type).replace(/\s+/g, "_");
      var e = {
        event_id: id || ("ROW-" + r._line),
        posting_id: clean(r.posting_id),
        variant: clean(r.variant).toUpperCase(),
        step: num(r.step),
        event_type: type,
        event_day: num(r.event_day),
        order: idx,
        flags: [],
        simulated: false
      };
      if (seen[e.event_id]) { issues.push({ level: "error", where: where, text: "Row skipped: duplicate event_id." }); return; }
      seen[e.event_id] = true;
      if (HI.rules.eventTypes.indexOf(type) < 0) { issues.push({ level: "warn", where: where, text: "Unknown event_type \"" + type + "\": not counted." }); e.ignored = true; }
      if (["A", "B"].indexOf(e.variant) < 0) issues.push({ level: "warn", where: where, text: "Variant \"" + e.variant + "\" is not A or B." });
      if (e.step == null || isNaN(e.step) || e.event_day == null || isNaN(e.event_day)) {
        issues.push({ level: "error", where: where, text: "Row skipped: step and event_day must be numbers." }); return;
      }
      out.push(e);
    });
    return { items: out, issues: issues };
  }

  HI.normalize = { jobs: jobs, candidates: candidates, events: events, roleKey: roleKey, domain: domain };
})(this.HI = this.HI || {});
