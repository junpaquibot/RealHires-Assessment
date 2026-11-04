/*
 * simulator.js: controller for simulator.html, the component simulator in the Actual build demo.
 * Pick a component on the left to see its live result on the data, the rule values it reads,
 * its real source code, and the options for deploying it. All numbers come from pipeline.run().
 */
(function (HI) {
  "use strict";
  var h = HI.ui.h, clear = HI.ui.clear;
  var $ = function (id) { return document.getElementById(id); };
  var TYPE_COLOR = { in: "var(--in)", step: "var(--step)", gate: "var(--gate)", dash: "var(--dash)", emp: "var(--emp)" };
  var STATUS = { eligible: ["Eligible", "ok"], needs_check: ["Needs verification", "warn"], duplicate_check: ["Duplicate check", "warn"], ineligible: ["Ineligible", ""] };
  var state = { id: "overview", sub: "result", outreachLead: null, suppFilter: "all" };
  var S = null;

  // ---------- helpers ----------
  function pill(text, cls) { return h("span", { class: "pill " + (cls || ""), text: text }); }
  function status(l) { var s = STATUS[l.eligibility.status]; return pill(s[0], s[1]); }
  function kpi(v, l) { return h("div", { class: "kpi" }, h("div", { class: "v", text: String(v) }), h("div", { class: "l", text: l })); }
  function card(title, aside, body) { return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: title }), aside ? h("span", null, aside) : null), h("div", { class: "card-body" }, body)); }
  function table(cols, rows, empty) {
    if (!rows.length) return h("div", { class: "empty", text: empty || "Nothing to show." });
    return h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { class: c.cls || null, text: c.label }); }))),
      h("tbody", null, rows.map(function (r) { return h("tr", null, cols.map(function (c) { return h("td", { class: c.cls || null }, c.get(r)); })); }))));
  }
  function co(l) { return h("div", null, h("b", { text: l.primary.company }), h("div", { class: "faint", style: { fontSize: "12.5px" }, text: l.primary.title + " · " + l.postingIds.join(" + ") })); }
  function leadOf(e) { return e.leadKey ? S.leads.filter(function (l) { return l.key === e.leadKey; })[0] : null; }
  var toastTimer = null;
  function toast(text, error) {
    var t = $("toast"); t.textContent = text; t.className = "toast" + (error ? " error" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, error ? 6000 : 2600);
  }

  // ---------- live results, one per component ----------
  var LIVE = {
    jobs: function () {
      return [
        h("div", { class: "kpis" }, kpi(S.jobs.length, "Postings loaded"), kpi(S.sources.jobs, "File"), kpi(S.importIssues.filter(function (i) { return /^jobs/.test(i.where); }).length, "Issues found")),
        card("Postings as loaded", null, table([
          { label: "ID", get: function (j) { return j.posting_id; } },
          { label: "Company", get: function (j) { return h("b", { text: j.company }); } },
          { label: "Title", get: function (j) { return j.title; } },
          { label: "Remote", get: function (j) { return j.remote_policy; } },
          { label: "U.S. hrs", get: function (j) { return j.us_hours_required; } },
          { label: "Posted", cls: "num", get: function (j) { return j.posted_days_ago + "d"; } },
          { label: "Reposts", cls: "num", get: function (j) { return String(j.repost_count); } }
        ], S.jobs))
      ];
    },
    candidates: function () {
      return card("Candidates as loaded", S.candidates.length + " rows", table([
        { label: "ID", get: function (c) { return h("b", { text: c.candidate_id }); } },
        { label: "Specialty", get: function (c) { return c.role_specialty; } },
        { label: "Skills", get: function (c) { return c.skills_display.join(", "); } },
        { label: "Available now", get: function (c) { return c.available_now === "yes" ? pill("yes", "ok") : pill(c.available_now, "bad"); } },
        { label: "U.S. hours", get: function (c) { return c.us_hours_available === "yes" ? pill("yes", "ok") : pill(c.us_hours_available); } }
      ], S.candidates));
    },
    events: function () {
      var hist = S.events.filter(function (e) { return !e.simulated; });
      var counts = {};
      hist.forEach(function (e) { counts[e.event_type] = (counts[e.event_type] || 0) + 1; });
      var flagged = hist.filter(function (e) { return e.event_type === "sent" && e.flags.length; });
      return h("div", { class: "grid-2" },
        card("Events by type", hist.length + " rows", table([
          { label: "Type", get: function (k) { return k; } }, { label: "Count", cls: "num", get: function (k) { return String(counts[k]); } }
        ], Object.keys(counts))),
        card("Sends that break today's rules", flagged.length + " of " + counts.sent + " sends", table([
          { label: "Event", get: function (e) { return e.event_id + " · " + e.posting_id + " · " + e.variant; } },
          { label: "Why", get: function (e) { return h("span", { class: "flag", text: e.flags.join("; ") }); } }
        ], flagged)));
    },
    normalize: function () {
      var raw = HI.csv.parse(HI.store.texts().jobs.text).records.slice(0, 4);
      var byId = {}; S.jobs.forEach(function (j) { byId[j.posting_id] = j; });
      var issues = S.importIssues;
      return [
        card("Before → after (first rows)", "raw text vs. cleaned values", table([
          { label: "Posting", get: function (r) { return h("b", { text: r.posting_id }); } },
          { label: "Raw domain → clean", get: function (r) { var j = byId[(r.posting_id || "").trim()]; return h("span", null, h("code", { text: r.domain }), " → ", h("code", { text: j ? j.domain : "skipped" })); } },
          { label: "Raw skills → list", get: function (r) { var j = byId[(r.posting_id || "").trim()]; return h("span", null, h("code", { text: r.required_skills }), " → ", j ? j.required_skills.map(function (s) { return pill(s); }) : "skipped"); } },
          { label: "Role key", get: function (r) { var j = byId[(r.posting_id || "").trim()]; return j ? h("code", { text: j.role_key }) : "—"; } }
        ], raw)),
        card("Issues found", issues.length + "", issues.length ? h("ul", { class: "ev" }, issues.map(function (i) { return h("li", { class: "n", text: i.where + ": " + i.text }); }))
          : h("p", { class: "muted", text: "The sample file is clean. Import test-data/messy_jobs.csv (top right) to watch this step flag and fix problems." }))
      ];
    },
    dedup: function () {
      var groups = S.leads.filter(function (l) { return l.isDuplicate; });
      var how = { auto: ["Auto-merged: postings agree, the newest is the record", "ok"], needs_check: ["Postings disagree: an employee decides", "warn"], human_pick: ["Employee picked the record", "acc"], human_ineligible: ["Employee marked it ineligible", ""] };
      return [
        h("div", { class: "kpis" }, kpi(S.jobs.length, "Postings in"), kpi(S.leads.length, "Unique leads out"), kpi(groups.length, "Duplicate groups")),
        groups.map(function (l) {
          var r = how[l.resolution];
          return card(l.primary.company + " · " + l.primary.title, pill(r[0], r[1]), h("div", null,
            table([
              { label: "Posting", get: function (p) { return h("b", { text: p.posting_id + (p === l.primary ? " (record)" : "") }); } },
              { label: "Posted", cls: "num", get: function (p) { return p.posted_days_ago + "d ago"; } },
              { label: "Remote", get: function (p) { return p.remote_policy; } },
              { label: "U.S. hrs", get: function (p) { return p.us_hours_required; } },
              { label: "Employees", cls: "num", get: function (p) { return String(p.company_employees); } },
              { label: "Salary", cls: "num", get: function (p) { return String(p.salary_usd_per_year); } },
              { label: "Notes", get: function (p) { return p.notes; } }
            ], l.postings),
            l.conflicts.length ? h("div", { class: "note warn", text: "Conflicts (block auto-merge): " + l.conflicts.map(function (c) { return c.label; }).join(", ") }) : null,
            l.differences.length ? h("div", { class: "note", text: "Differences shown for information only: " + l.differences.map(function (d) { return d.label; }).join(", ") }) : null));
        })
      ];
    },
    eligibility: function () {
      var c = S.counts;
      return [
        h("div", { class: "kpis" }, kpi(c.eligible, "Eligible"), kpi(c.needs_check + c.duplicate_check, "Needs verification"), kpi(c.ineligible, "Ineligible")),
        card("Every lead and the rule that decided it", null, table([
          { label: "Lead", get: co },
          { label: "Remote policy", get: function (l) { return l.primary.remote_policy; } },
          { label: "Status", get: status },
          { label: "Reason", get: function (l) { return h("span", { class: "muted", text: l.eligibility.reasons.join("; ") }); } }
        ], S.leads))
      ];
    },
    matching: function () {
      var leads = S.leads.filter(function (l) { return l.eligibility.status !== "ineligible"; });
      return [
        card("Matches per lead", "eligible + awaiting verification", table([
          { label: "Lead", get: co },
          { label: "Verified", get: function (l) { return l.matches.verified.length ? l.matches.verified.map(function (m) { return pill(m.candidate.candidate_id, "ok"); }) : h("span", { class: "faint", text: "none" }); } },
          { label: "Best partial", get: function (l) { var m = l.matches.partial[0]; return m ? h("span", null, pill(m.candidate.candidate_id + " · " + m.matched.length + "/" + (m.matched.length + m.missing.length), "warn"), h("div", { class: "faint", style: { fontSize: "12.5px" }, text: m.gaps.join("; ") })) : "—"; } },
          { label: "Assigned", get: function (l) { return l.assignment ? pill(l.assignment.candidate_id + " · " + l.assignment.via, "acc") : (l.blockedBy.length ? h("span", { class: "faint", text: "held by " + l.blockedBy[0].company }) : (l.assignmentNote ? h("span", { class: "faint", text: "contact stopped" }) : "—")); } }
        ], leads)),
        card("Assignment: one candidate, one company", null, table([
          { label: "Candidate", get: function (p) { return h("b", { text: p.candidate.candidate_id + " · " + p.candidate.role_specialty }); } },
          { label: "Assigned to", get: function (p) { return p.assignedTo ? p.assignedTo.primary.company : h("span", { class: "faint", text: "nobody" }); } },
          { label: "Why", get: function (p) { return p.via ? ({ reply: "company replied positively", score: "highest score", moved: "moved by an employee" })[p.via] : ""; } }
        ], S.profiles))
      ];
    },
    scoring: function () {
      return card("Ranked leads with every point explained", S.ranked.length + " scored", table([
        { label: "Lead", get: co },
        { label: "Total", cls: "num", get: function (l) { return h("b", { text: String(l.score.total) + (l.score.pending ? " (pending)" : "") }); } },
        { label: "Elig.", cls: "num", get: function (l) { return l.score.parts.eligibility.points + "/30"; } },
        { label: "Fit", cls: "num", get: function (l) { return l.score.parts.fit.points + "/40"; } },
        { label: "Urgency", cls: "num", get: function (l) { return l.score.parts.urgency.points + "/30"; } },
        { label: "Why", get: function (l) { var p = l.score.parts; return h("div", { class: "muted", style: { fontSize: "12.5px" } }, h("div", { text: "Fit: " + p.fit.reason }), h("div", { text: "Urgency: " + p.urgency.reason })); } }
      ], S.ranked));
    },
    outreach: function () {
      var leads = S.ranked.filter(function (l) { return l.drafts.eligible; });
      if (!leads.length) return h("div", { class: "empty", text: "No eligible leads." });
      var cur = leads.filter(function (l) { return l.key === state.outreachLead; })[0] || leads[0];
      var sel = h("select", { onchange: function (e) { state.outreachLead = e.target.value; render(); } },
        leads.map(function (l) { return h("option", { value: l.key, selected: l === cur ? true : null, text: l.primary.company + " · " + l.primary.title + (l.drafts.A.available ? "" : " (B only)") }); }));
      return [
        h("div", { class: "kpis" }, kpi(leads.length, "Eligible leads with drafts"), kpi(leads.filter(function (l) { return l.drafts.A.available; }).length, "Have variant A"), kpi(0, "Emails actually sent")),
        h("div", { class: "controls" }, h("span", { class: "muted", text: "Lead:" }), sel),
        h("div", { class: "grid-2" }, ["A", "B"].map(function (v) {
          var d = cur.drafts[v];
          return card(v === "A" ? "Variant A · candidate-first" : "Variant B · process-first", d.available ? d.words + " words" : null,
            d.available ? h("div", null, h("div", { class: "mail" }, h("div", { class: "subj", text: d.subject }), h("div", { class: "body", text: d.body })),
              h("ul", { class: "ev", style: { marginTop: "10px" } }, d.claims.map(function (c) { return h("li", { class: "y", text: c }); })))
              : h("div", { class: "unavail", text: d.reason }));
        }))
      ];
    },
    suppression: function () {
      var rows = S.leads.filter(function (l) { return l.followups.steps.length; });
      var kind = function (l) { return l.followups.check.ok ? "clear" : l.followups.check.kind; };
      var shown = rows.filter(function (l) { return state.suppFilter === "all" || kind(l) === state.suppFilter; });
      var seg = h("div", { class: "seg" }, [["all", "All"], ["clear", "Clear to send"], ["cancelled", "Stopped"], ["paused", "Paused"]].map(function (o) {
        return h("button", { class: state.suppFilter === o[0] ? "on" : null, onclick: function () { state.suppFilter = o[0]; render(); } }, o[1] + " (" + rows.filter(function (l) { return o[0] === "all" || kind(l) === o[0]; }).length + ")");
      }));
      return [h("div", { class: "controls" }, seg), card("What the check says right now", null, table([
        { label: "Lead", get: co },
        { label: "Result", get: function (l) { var k = kind(l); return pill(k === "clear" ? "Send" : k === "paused" ? "Paused" : "Stopped", k === "clear" ? "ok" : k === "paused" ? "warn" : "bad"); } },
        { label: "Reason", get: function (l) { return h("span", { class: "muted", text: l.followups.check.reason }); } }
      ], shown))];
    },
    tracking: function () {
      var f = S.funnel;
      var keys = HI.metrics.KEYS;
      return [
        card("Funnel by variant", "as recorded in events.csv", table([
          { label: "Metric", get: function (k) { return HI.metrics.LABELS[k]; } },
          { label: "A", cls: "num", get: function (k) { return String(f.values.A[k]); } },
          { label: "B", cls: "num", get: function (k) { return String(f.values.B[k]); } },
          { label: "Overall", cls: "num", get: function (k) { return h("b", { text: String(f.values.overall[k]) }); } },
          { label: "⚠ flagged", cls: "num", get: function (k) { return f.flagged.overall[k] ? h("span", { class: "flag", text: String(f.flagged.overall[k]) }) : "0"; } }
        ], keys)),
        h("div", { class: "note", text: "Open rate ≈ " + Math.round(f.values.overall.open_rate * 100) + "% = " + f.values.overall.unique_opens + " unique opens ÷ " + f.values.overall.delivered + " delivered. " + f.values.overall.raw_opens + " open events were recorded; repeats of the same email count once." })
      ];
    },
    stops: function () {
      var sims = HI.store.decisions().simEvents;
      var leads = S.leads.slice().sort(function (a, b) { return a.primary.posting_id.localeCompare(b.primary.posting_id); });
      var selLead = h("select", null, leads.map(function (l) { return h("option", { value: l.primary.posting_id, text: l.primary.posting_id + " · " + l.primary.company }); }));
      var firstClear = leads.filter(function (l) { return l.followups.check.ok; })[0];
      if (firstClear) selLead.value = firstClear.primary.posting_id;
      var selType = h("select", null, Object.keys(HI.rules.stopEvents).map(function (k) { return h("option", { value: k, text: HI.rules.stopEvents[k].label }); }));
      var day = h("input", { type: "number", min: "0", max: "365", value: String(S.today), style: { width: "80px" } });
      var scheduled = S.leads.filter(function (l) { return l.followups.steps.length; });
      return [
        card("Try it: simulate a reply, bounce or unsubscribe", "simulated events never change the campaign numbers", h("div", null,
          h("div", { class: "controls" }, selLead, selType, h("span", { class: "muted", text: "day" }), day,
            h("button", { class: "btn primary small", onclick: function () {
              var d = parseInt(day.value, 10);
              HI.store.addSim({ posting_id: selLead.value, event_type: selType.value, event_day: isFinite(d) ? d : S.today });
              toast("Simulated " + selType.value + " added for " + selLead.value);
            } }, "Add event"),
            sims.length ? h("button", { class: "btn small", onclick: function () { HI.store.clearSims(); toast("Simulated events cleared"); } }, "Clear " + sims.length + " simulated") : null))),
        card("Stop log", S.stopLog.length + " stop events", table([
          { label: "Day", cls: "num", get: function (r) { return String(r.event.event_day); } },
          { label: "Company", get: function (r) { return h("b", { text: r.company }); } },
          { label: "Event", get: function (r) { return pill(HI.rules.stopEvents[r.event.event_type].label + (r.event.simulated ? " (sim)" : ""), r.event.event_type === "replied_positive" ? "ok" : "bad"); } },
          { label: "Covers", get: function (r) { return r.postings.join(" + "); } },
          { label: "Cancelled", get: function (r) { return r.firstStop ? (r.cancelled.join(", ") || "nothing pending") : h("span", { class: "faint", text: "already stopped" }); } }
        ], S.stopLog)),
        card("Follow-up schedule (today = day " + S.today + ")", "email 1, then email 2 three days later", table([
          { label: "Lead", get: co },
          { label: "Steps", get: function (l) { return l.followups.steps.map(function (s) { return pill("Email " + s.step + " · day " + s.day + " · " + s.status, { sent: "", due: "ok", scheduled: "acc", paused: "warn", cancelled: "bad" }[s.status]); }); } }
        ], scheduled))
      ];
    },
    dashboard: function () {
      return [
        card("The dashboard is the product page, index.html", null, h("div", null,
          h("p", null, "The product is ", h("code", { text: "index.html" }), " in this folder: the same engine files in ", h("code", { text: "js/" }), " plus the screens in ", h("code", { text: "product/" }), ". ", h("code", { text: "tools/build-product.js" }), " packs that page into the standalone ", h("code", { text: "App-product.html" }), ". So both show exactly the numbers you see here."))),
        card("What the dashboard reads from the snapshot", null, table([
          { label: "Snapshot field", get: function (r) { return h("code", { text: r[0] }); } }, { label: "Used for", get: function (r) { return r[1]; } }
        ], [["ranked", "Ranked opportunities"], ["leads", "Leads tab, verification queue, lead drawer"], ["profiles", "Candidates tab"], ["funnel", "Campaign funnel, A/B comparison"], ["stopLog", "Stop rules list"], ["notes", "Data notes"], ["counts", "Headline numbers"]]))
      ];
    },
    employee: function () {
      var pending = S.leads.filter(function (l) { return l.eligibility.status === "needs_check" || l.eligibility.status === "duplicate_check"; });
      var audit = HI.store.decisions().audit;
      return [
        card("Waiting for a decision", pending.length + " leads", table([
          { label: "Lead", get: co },
          { label: "Why", get: function (l) { return h("span", { class: "muted", text: l.eligibility.reasons[0] }); } },
          { label: "", get: function (l) {
            if (l.eligibility.status === "duplicate_check") return l.postings.map(function (p) { return h("button", { class: "btn small", style: { margin: "0 6px 6px 0" }, onclick: function () { HI.store.setDuplicate(l, p.posting_id); } }, "Use " + p.posting_id); });
            return [h("button", { class: "btn small primary", style: { marginRight: "6px" }, onclick: function () { HI.store.setCheck(l, "eligible"); } }, "Confirm"), h("button", { class: "btn small", onclick: function () { HI.store.setCheck(l, "ineligible"); } }, "Reject")];
          } }
        ], pending, "Nothing waiting.")),
        card("Audit log", audit.length + " actions", table([
          { label: "When", get: function (r) { return new Date(r.at).toLocaleString(); } },
          { label: "Action", get: function (r) { return h("b", { text: r.action }); } },
          { label: "Detail", get: function (r) { return r.detail; } }
        ], audit, "No actions yet. Confirm a lead above and watch every component update."))
      ];
    }
  };

  // ---------- rules / code / deploy tabs ----------
  function fmt(v) {
    if (Array.isArray(v)) return v.map(function (x) { return typeof x === "object" ? JSON.stringify(x) : String(x); }).join(", ");
    if (v && typeof v === "object") return JSON.stringify(v, null, 1).replace(/\n\s*/g, " ");
    return String(v);
  }
  function rulesTab(c) {
    if (!c.rules.length) return card("Rules", null, h("p", { class: "muted", text: "This component has no settings of its own." }));
    var grid = h("div", { class: "kv" });
    c.rules.forEach(function (k) { grid.appendChild(h("div", { class: "k", text: "rules." + k })); grid.appendChild(h("div", { class: "v", text: fmt(HI.rules[k]) })); });
    return card("Settings this component reads", "from js/rules.js. Change them there and every view follows", grid);
  }
  function codeTab(c) {
    var src = "";
    try { src = String(c.fnRef()); } catch (e) { src = "// source not available"; }
    var idx = HI.components.list.indexOf(c), prev = HI.components.list[idx - 1], next = HI.components.list[idx + 1];
    return card("The real code", c.fn, h("div", null,
      h("div", { class: "fn-meta" },
        h("div", null, h("b", { text: "File" }), h("code", { text: c.file })),
        h("div", null, h("b", { text: "Main function" }), h("code", { text: c.fn + "()" })),
        h("div", null, h("b", { text: "Comes after" }), prev ? prev.title : "—"),
        h("div", null, h("b", { text: "Feeds into" }), next ? next.title : "—")),
      h("pre", { class: "code", text: src }),
      h("div", { class: "note", text: "This is the exact function the app is running right now (shown with Function.toString). Tests: node tests/engine.test.js." })));
  }
  function deployTab(c) {
    return card("How it could be deployed", "recommended option highlighted", h("div", null,
      h("div", { class: "opts" }, c.deploy.map(function (o) {
        return h("div", { class: "opt" + (o.pick ? " pick" : "") },
          h("h3", null, h("span", { text: o.name }), o.pick ? pill("Recommended", "acc") : null),
          h("p", { text: o.how }),
          h("ul", null, o.pros.map(function (p) { return h("li", { class: "pro", text: p }); }), o.cons.map(function (p) { return h("li", { class: "con", text: p }); })));
      })),
      h("div", { class: "prod-line" }, h("b", { text: "In production: " }), c.prod)));
  }

  // ---------- overview ----------
  function overview() {
    var o = S.funnel.values.overall;
    var steps = [
      ["jobs", S.counts.postings, "postings"], ["dedup", S.counts.leads, "unique leads"], ["eligibility", S.counts.eligible, "eligible"],
      ["matching", S.leads.filter(function (l) { return l.assignment; }).length, "with an assigned candidate"],
      ["outreach", S.leads.filter(function (l) { return l.drafts.eligible && l.drafts.A.available; }).length, "with variant A"],
      ["tracking", o.sent, "emails sent (history)"], ["tracking", o.replied_positive, "positive replies"], ["tracking", o.client_won, "client won"]
    ];
    return [
      h("div", { class: "comp-head" }, h("div", null, h("div", { class: "group", style: { color: "var(--accent)" }, text: "Actual build demo" }),
        h("h1", { text: "How the app is built, one component at a time" }),
        h("p", { text: "Every box below is a real JavaScript file. One function, pipeline.run(), passes the data through them in order. Pick a component on the left to see its live result, its settings, its code and how it would be deployed." }))),
      card("The data, flowing through the pipeline", "click a step", h("div", { class: "flow" }, steps.map(function (s, i) {
        return [i ? h("span", { class: "arrow", text: "→" }) : null, h("button", { class: "step", onclick: function () { go(s[0]); } }, h("b", { text: String(s[1]) }), s[2])];
      }))),
      card("Components", HI.components.list.length + " parts", table([
        { label: "Component", get: function (c) { return h("a", { href: "#" + c.id, onclick: function (e) { e.preventDefault(); go(c.id); } }, c.title); } },
        { label: "Does", get: function (c) { return h("span", { class: "muted", text: c.what }); } },
        { label: "File", get: function (c) { return h("code", { text: c.file }); } },
        { label: "Req.", get: function (c) { return pill(c.req, "acc"); } }
      ], HI.components.list))
    ];
  }

  // ---------- render ----------
  function sideCount(c) {
    var map = { jobs: S.jobs.length, candidates: S.candidates.length, events: S.events.filter(function (e) { return !e.simulated; }).length, dedup: S.leads.length,
      eligibility: S.counts.eligible, scoring: S.ranked.length, employee: S.counts.needs_check + S.counts.duplicate_check };
    return map[c.id] != null ? String(map[c.id]) : "";
  }
  function renderSide() {
    var side = clear($("side"));
    side.appendChild(h("button", { class: state.id === "overview" ? "on" : null, onclick: function () { go("overview"); } }, h("i", { style: { background: "var(--accent)" } }), "Overview"));
    HI.components.GROUPS.forEach(function (g) {
      side.appendChild(h("h4", { text: g.label }));
      HI.components.list.filter(function (c) { return c.group === g.id; }).forEach(function (c) {
        side.appendChild(h("button", { class: state.id === c.id ? "on" : null, onclick: function () { go(c.id); } },
          h("i", { style: { background: TYPE_COLOR[c.type] } }), c.title, h("span", { class: "n", text: sideCount(c) })));
      });
    });
  }
  function render() {
    S = HI.store.snapshot();
    renderSide();
    var imported = Object.keys(S.origin).filter(function (k) { return S.origin[k] === "imported"; });
    var src = $("source"); src.textContent = imported.length ? "Imported: " + imported.join(", ") : "Sample data"; src.className = "chip" + (imported.length ? " warn" : "");
    var main = clear($("main"));
    if (state.id === "overview") { [].concat(overview()).forEach(function (n) { main.appendChild(n); }); return; }
    var c = HI.components.byId(state.id);
    var g = HI.components.GROUPS.filter(function (x) { return x.id === c.group; })[0];
    main.appendChild(h("div", { class: "comp-head" },
      h("div", null, h("div", { class: "group", style: { color: g.color }, text: g.label }), h("h1", { text: c.title }), h("p", { text: c.what })),
      pill(c.req, "acc")));
    main.appendChild(h("div", { class: "io" },
      h("div", null, h("b", { text: "Takes in" }), c.takes), h("div", null, h("b", { text: "Gives out" }), c.gives), h("div", null, h("b", { text: "Code" }), h("code", { text: c.file }))));
    main.appendChild(h("div", { class: "subtabs", role: "tablist" }, [["result", "Live result"], ["rules", "Rules"], ["code", "Code"], ["deploy", "Deploying it"]].map(function (t) {
      return h("button", { class: state.sub === t[0] ? "on" : null, role: "tab", "aria-selected": String(state.sub === t[0]), onclick: function () { state.sub = t[0]; render(); } }, t[1]);
    })));
    var body = state.sub === "rules" ? rulesTab(c) : state.sub === "code" ? codeTab(c) : state.sub === "deploy" ? deployTab(c) : LIVE[c.id]();
    [].concat(body).forEach(function (n) { if (n) [].concat(n).forEach(function (x) { if (x) main.appendChild(x); }); });
  }
  function go(id) {
    state.id = id; state.sub = "result";
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// can block this */ }
    render(); window.scrollTo(0, 0);
  }

  function onImport(files) {
    var list = Array.prototype.slice.call(files || []), ok = [], bad = [];
    var chain = Promise.resolve();
    list.forEach(function (file) {
      chain = chain.then(function () {
        return HI.sources.readFile(file).then(function (text) {
          var kind = HI.sources.detectKind(text);
          if (!kind) throw new Error(file.name + ": not a jobs, candidates or events file");
          HI.store.importText(kind, text, file.name); ok.push(file.name);
        }).catch(function (e) { bad.push(e.message); });
      });
    });
    chain.then(function () { $("import-file").value = ""; if (bad.length) toast(bad.join(" · "), true); else toast("Imported " + ok.join(", ") + ". Every component re-ran."); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var hash = (location.hash || "").slice(1);
    if (HI.components.byId(hash)) state.id = hash;
    $("import-btn").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function (e) { onImport(e.target.files); });
    $("sample-btn").addEventListener("click", function () { HI.store.loadSample(); toast("Sample data loaded"); });
    $("reset-btn").addEventListener("click", function () { if (window.confirm("Clear employee decisions, candidate moves and simulated events?")) { HI.store.resetDecisions(); toast("Decisions reset"); } });
    window.addEventListener("hashchange", function () { var id = (location.hash || "").slice(1); if (id && id !== state.id && (id === "overview" || HI.components.byId(id))) { state.id = id; state.sub = "result"; render(); } });
    HI.store.onChange(render);
    try { HI.store.init(); }
    catch (e) { clear($("main")).appendChild(h("div", { class: "empty", text: "The data couldn't be processed: " + e.message })); }
  });
})(this.HI = this.HI || {});
