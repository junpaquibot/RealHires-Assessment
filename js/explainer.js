/*
 * explainer.js: controller for explainer.html. It opens the app up part by part.
 * It calls the same pipeline (via the same store), so every number here matches the app view exactly.
 */
(function (HI) {
  "use strict";
  var ui = HI.ui, h = ui.h;

  function lead(S, id) { return S.leads.filter(function (l) { return l.postingIds.indexOf(id) >= 0; })[0]; }
  function li(items) { return h("ul", { class: "plain" }, items.filter(Boolean).map(function (x) { return h("li", null, x); })); }
  function code(t) { return h("code", { text: t }); }

  var COMPONENTS = [
    {
      id: "data", layer: "Data", title: "Sample data", req: "Inputs", file: "data/*.csv → js/sample-data.js", fn: "HI.sampleData",
      what: "Three synthetic CSVs: job postings, candidates and campaign events. Browsers can't read local files on their own, so the sample text is embedded in a script. An import button can replace any of the three.",
      io: function (S) {
        return {
          input: li(["data/" + "hireintercept_sample_jobs.csv", "data/hireintercept_sample_candidates.csv", "data/hireintercept_sample_events.csv"]),
          rule: li(["Regenerate with " + "node tools/embed-data.js" + " after changing a CSV", "events.csv is history: reported as recorded, never rewritten"]),
          output: li([S.jobs.length + " postings · " + S.candidates.length + " candidates · " + S.events.filter(function (e) { return !e.simulated; }).length + " events"])
        };
      },
      next: "Retrieval", prod: "Postgres tables, kept current by scheduled syncs from Apollo / job feeds and Finally Staff."
    },
    {
      id: "retrieval", layer: "Retrieval", title: "Load + parse", req: "R1 import", file: "js/sources.js, js/csv.js", fn: "sources.loadSample() · sources.readFile() · sources.parseKind() · csv.parse()",
      what: "Gets raw CSV text, from the embedded sample or an imported file, and parses it. Files over 5 MB, non-CSV files and files missing required columns are rejected before anything changes.",
      io: function (S) {
        return {
          input: li(["Raw text: " + S.sources.jobs + ", " + S.sources.candidates + ", " + S.sources.events]),
          rule: li(["Required columns per file type (e.g. jobs needs posting_id, domain, title, remote_policy…)", "Import auto-detects the file type from its header row", "Quoted fields, commas inside quotes and Excel's byte-order mark are handled"]),
          output: li(["Rows as plain text records. Nothing is evaluated or executed."])
        };
      },
      next: "Normalize", prod: "Apollo API client plus the Finally Staff API client, run by a scheduler (cron) or webhooks."
    },
    {
      id: "normalize", layer: "Normalize", title: "Clean + flag", req: "R1", file: "js/normalize.js", fn: "normalize.jobs() · normalize.candidates() · normalize.events()",
      what: "Turns messy text into consistent values: trimmed text, lower-case domains, skills split on \";\", and yes/no values standardised. It never guesses. Unknown values are flagged and treated cautiously later.",
      io: function (S) {
        var j = S.jobs[0];
        return {
          input: li(["\"" + j.required_skills_display.join(";") + "\"", "\"" + j.domain + "\", \"" + j.remote_policy + "\", \"" + j.us_hours_required + "\""]),
          rule: li(["Unknown remote policy → goes to human check", "Unknown availability → never described as available", "Rows missing posting_id / domain / title are skipped and reported"]),
          output: li([S.jobs.length + " clean postings", S.importIssues.length + " import issue(s) found (see Data notes)"])
        };
      },
      next: "Dedup", prod: "The same function, run inside the sync job before rows are written to the database."
    },
    {
      id: "dedup", layer: "Core logic · Leads", title: "Deduplicate", req: "R1.2", file: "js/dedup.js", fn: "dedup.group(jobs, decisions)",
      what: "Groups postings by company domain + role. The most recent posting is the record, unless the postings disagree on something that affects eligibility or matching. Then a person decides in Duplicate check.",
      io: function (S) {
        var n = lead(S, "JOB-002"), hb = lead(S, "JOB-004");
        return {
          input: li([S.jobs.length + " postings", n ? "JOB-002 + JOB-029 (Northline) · JOB-004 + JOB-030 (Harborwell)" : null]),
          rule: li(["Same domain + role → one lead; every posting ID stays linked", "Conflict fields: remote policy, U.S. hours, required skills, title", "Headcount, salary, notes differences → shown as information only"]),
          output: li([S.leads.length + " leads from " + S.jobs.length + " postings",
            n ? "Northline: no conflicts → " + n.primary.posting_id + " is the record (" + n.resolution + ")" : null,
            hb ? "Harborwell: " + (hb.conflicts.length ? "conflicts on " + hb.conflicts.map(function (c) { return c.label.toLowerCase(); }).join(" + ") + " → " : "") + hb.eligibility.status.replace("_", " ") : null])
        };
      },
      next: "Eligibility", prod: "A database unique key on (domain, role) plus a review table for conflicts."
    },
    {
      id: "eligibility", layer: "Core logic · Leads", title: "Eligibility", req: "R1", file: "js/eligibility.js", fn: "eligibility.evaluate(lead, decisions)",
      what: "Decides whether a lead can be filled from overseas. Hard rules make a lead ineligible. Unclear cases go to a person instead of being assumed.",
      io: function (S) {
        var c = S.counts;
        return {
          input: li(["remote_policy, notes, title, required skills of the primary posting", "Reviewer decisions from the Review queue"]),
          rule: li(["US_ONLY / ONSITE / licence keyword → ineligible", "REMOTE_UNSPECIFIED, or GLOBAL + \"unclear local restriction\" → needs human check", "Duplicate conflict → duplicate check", "Otherwise GLOBAL → eligible"]),
          output: li([c.eligible + " eligible · " + c.needs_check + " needs check · " + c.duplicate_check + " duplicate check · " + c.ineligible + " ineligible"])
        };
      },
      next: "Matching", prod: "Same rules, with reviewer decisions stored in a table and shown in a queue."
    },
    {
      id: "matching", layer: "Core logic · Leads", title: "Candidate matching + assignment", req: "R3", file: "js/matching.js, js/assignment.js", fn: "matching.forLead(lead, candidates) · assignment.run(leads, stops, decisions)",
      what: "Compares required skills with each candidate and lists evidence and gaps. Then each verified candidate is assigned to one lead at a time.",
      io: function (S) {
        var g = lead(S, "JOB-014"), b = lead(S, "JOB-016");
        return {
          input: li(["Required skills + U.S. hours of each lead", S.candidates.length + " candidates (synthetic)"]),
          rule: li(["Verified = all skills + available_now = yes + U.S. hours if the job requires them", "Partial = at least one skill; gaps always listed", "Assignment: stopped contacts release → positive replies first → highest score"]),
          output: li([g && g.assignment ? "Goldleaf (JOB-014) → " + g.assignment.candidate_id + " verified and assigned" : null,
            b && b.blockedBy.length ? "Blue Mesa (JOB-016) → verified " + b.blockedBy[0].candidate_id + " but it's assigned to " + b.blockedBy[0].company : null,
            S.profiles.filter(function (p) { return p.assignedTo; }).length + " of " + S.candidates.length + " candidates assigned"])
        };
      },
      next: "Scoring", prod: "A matching service over the Finally Staff candidate pool, with reservations stored per candidate."
    },
    {
      id: "scoring", layer: "Core logic · Leads", title: "Priority score", req: "R2", file: "js/scoring.js", fn: "scoring.score(lead)",
      what: "An explainable 0–100 score. Every point has a reason the user can see.",
      io: function (S) {
        var top = S.ranked[0];
        return {
          input: li(["Eligibility status, best candidate match, notes, posted_days_ago, repost_count, linked postings"]),
          rule: li(["Eligibility 30 (pending = 10)", "Fit 40 verified · partial = 30 × share of skills", "Urgency 30: \"urgent\" +10 · ≤ 7 days +10 / ≤ 21 days +5 · repeat posting +10 (\"may indicate ongoing need, not proof\")", "Salary, size, other notes: context only"]),
          output: li([top ? "Top: " + top.primary.company + " = " + top.score.parts.eligibility.points + " + " + top.score.parts.fit.points + " + " + top.score.parts.urgency.points + " = " + top.score.total : null,
            S.ranked.length + " leads scored (" + S.ranked.filter(function (l) { return l.score.pending; }).length + " pending)"])
        };
      },
      next: "Outreach", prod: "Same function on the server. Weights stay in config (rules.js → a settings table)."
    },
    {
      id: "outreach", layer: "Core logic · Campaign", title: "A/B drafts", req: "R4", file: "js/outreach.js", fn: "outreach.drafts(lead)",
      what: "Two short, truthful first-contact emails per eligible lead. A is candidate-first and only exists with an assigned verified candidate. B is process/speed-first. Unknown facts stay as [placeholders].",
      io: function (S) {
        var el = S.leads.filter(function (l) { return l.drafts.eligible; });
        return {
          input: li(["Eligible leads, their assigned candidate (if any), the job title and skills"]),
          rule: li(["No verified, assigned candidate → no variant A", "Under 120 words, one ask, opt-out line", "Only claims backed by the data (skills, available_now, us_hours_available)"]),
          output: li([el.length + " leads with drafts · " + el.filter(function (l) { return l.drafts.A.available; }).length + " have variant A · nothing is sent"])
        };
      },
      next: "Campaign", prod: "Templates pushed to Apollo sequences, sent only after the stop check passes."
    },
    {
      id: "campaign", layer: "Core logic · Campaign", title: "Campaign events + flags", req: "R5", file: "js/campaign.js", fn: "campaign.attach() · campaign.stopsByDomain() · campaign.flagSends()",
      what: "Links each event to its lead, collects stop events per contact (company domain) and flags historical sends that broke today's rules.",
      io: function (S) {
        return {
          input: li([S.events.filter(function (e) { return !e.simulated; }).length + " events from " + S.sources.events]),
          rule: li(["Contact = company domain (assumption: no contact column)", "Flag: sent to an ineligible lead · sent before verification · variant A with no verified candidate · sent after a stop"]),
          output: li([S.counts.flaggedSends + " of " + S.funnel.values.overall.sent + " sends flagged ⚠ (counted as recorded)", Object.keys(S.stops).length + " contacts with a stop event"])
        };
      },
      next: "Metrics + Follow-ups", prod: "Apollo webhooks write events to an events table as they happen."
    },
    {
      id: "metrics", layer: "Core logic · Campaign", title: "Funnel metrics", req: "R5", file: "js/metrics.js", fn: "metrics.funnel(events, filter)",
      what: "Counts sent, delivered, unique opens, bounces, replies, meetings and wins, by variant and overall, with a ⚠ flagged count beside each.",
      io: function (S) {
        var o = S.funnel.values.overall;
        return {
          input: li(["Events (simulated what-ifs excluded)"]),
          rule: li(["Unique opens = one per message (posting + step)", "Open rate = unique opens ÷ delivered, always ≈"]),
          output: li([o.raw_opens + " open events → " + o.unique_opens + " unique opens", "Open rate ≈ " + ui.pct(o.open_rate) + " · " + o.replied_positive + " positive replies · " + o.client_won + " client won"])
        };
      },
      next: "Dashboard", prod: "A SQL view or a nightly rollup table."
    },
    {
      id: "followups", layer: "Core logic · Campaign", title: "Follow-ups + stop rules", req: "R6", file: "js/followups.js", fn: "followups.schedule(lead, stops, today) · followups.canSend(lead, stops)",
      what: "Plans each lead's next step and runs the stop check that would run right before every send.",
      io: function (S) {
        var hb = lead(S, "JOB-030");
        return {
          input: li(["History sends per lead, stop events per domain, today = day " + S.today]),
          rule: li(["Sequence from the history: step 1, step 2 at +3 days, no step 3", "Any reply, bounce or unsubscribe → cancel all pending steps for the domain", "Ineligible → cancelled · waiting for review → paused"]),
          output: li([hb && hb.followups.check.stop ? "JOB-004's unsubscribe also stops linked JOB-030 ✓" : null,
            S.leads.filter(function (l) { return l.followups.steps.some(function (s) { return s.status === "due"; }); }).length + " leads have a step due now",
            S.stopLog.length + " stop events in the log"])
        };
      },
      next: "Dashboard", prod: "A job queue with delayed jobs. Each job re-runs canSend() just before it calls Apollo."
    },
    {
      id: "quality", layer: "Results", title: "Data notes", req: "R7.1", file: "js/quality.js", fn: "quality.notes(snapshot)",
      what: "Lists things a person should know. It never corrects the data.",
      io: function (S) {
        var areas = {};
        S.notes.forEach(function (n) { areas[n.area] = (areas[n.area] || 0) + 1; });
        return {
          input: li(["The full snapshot"]),
          rule: li(["Company name vs industry label mismatches", "Duplicate opens, replies without an open", "Follow-ups the history didn't send"]),
          output: li(Object.keys(areas).map(function (a) { return a + ": " + areas[a]; }))
        };
      },
      next: "Dashboard", prod: "A data-quality report emailed to ops, or alerts on the sync job."
    },
    {
      id: "pipeline", layer: "Orchestration", title: "Pipeline, rules + store", req: "All", file: "js/pipeline.js, js/rules.js, js/store.js", fn: "pipeline.run(texts, decisions) → snapshot",
      what: "One pure function runs every step in order and returns a snapshot. Both views call it, so their numbers always match. rules.js holds every weight and keyword. store.js keeps reviewer decisions and the audit log in this browser.",
      io: function (S) {
        var d = HI.store.decisions();
        return {
          input: li(["CSV text + reviewer decisions (" + Object.keys(d.checks).length + " checks, " + Object.keys(d.duplicates).length + " duplicate picks, " + Object.keys(d.moves).length + " moves, " + d.simEvents.length + " simulated events)"]),
          rule: li(["normalize → dedup → eligibility → matching → scoring → events → assignment → follow-ups → drafts → metrics → notes"]),
          output: li(["One snapshot used by both index.html and explainer.html", "Tested by node tests/engine.test.js"])
        };
      },
      next: "UI", prod: "A backend service (Node/TypeScript) with Postgres. The same modules move server-side almost unchanged."
    },
    {
      id: "ui", layer: "UI", title: "App view", req: "R7", file: "index.html, js/app.js, js/ui.js, styles.css", fn: "app.render()",
      what: "Renders the snapshot as tabs: dashboard, leads, review queue, candidates, drafts, campaign, follow-ups, notes and audit. Data is always inserted as text, never as HTML.",
      io: function (S) {
        return {
          input: li(["The snapshot"]),
          rule: li(["No business logic in the UI", "Text-only rendering (no innerHTML) and a Content-Security-Policy that blocks network calls"]),
          output: li([h("a", { href: "index.html", text: "Open the app view →" })])
        };
      },
      next: null, prod: "The same UI served by the backend, behind a login."
    }
  ];

  function render(S) {
    var flow = ui.clear(document.getElementById("flow"));
    COMPONENTS.forEach(function (c, i) {
      if (i) flow.appendChild(h("span", { class: "arrow", text: "→" }));
      flow.appendChild(h("button", { onclick: function () { document.getElementById("c-" + c.id).scrollIntoView({ behavior: "smooth" }); } }, c.title));
    });
    var main = ui.clear(document.getElementById("components"));
    COMPONENTS.forEach(function (c) {
      var io = c.io(S);
      main.appendChild(h("article", { class: "ex", id: "c-" + c.id },
        h("div", { class: "ex-head" }, h("div", null, h("div", { class: "layer", text: c.layer }), h("h2", { text: c.title })), ui.tag(c.req)),
        h("p", { text: c.what }),
        h("div", { class: "iro" },
          h("div", null, h("h4", { text: "Input" }), io.input),
          h("div", null, h("h4", { text: "Rule" }), io.rule),
          h("div", null, h("h4", { text: "Output (live)" }), io.output)),
        h("div", { class: "meta" },
          h("div", null, h("b", { text: "Code: " }), code(c.file), h("br"), h("small", { text: c.fn })),
          h("div", null, h("b", { text: "Feeds: " }), c.next || "the user"),
          h("div", null, h("b", { text: "In production: " }), c.prod))));
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    HI.store.onChange(render);
    try { HI.store.init(); }
    catch (e) { ui.clear(document.getElementById("components")).appendChild(h("div", { class: "banner error", text: "The data couldn't be processed: " + e.message })); }
  });
})(this.HI = this.HI || {});
