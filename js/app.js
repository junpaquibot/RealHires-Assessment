/*
 * app.js: controller for the app view (index.html). It renders the snapshot from pipeline.run() into tabs,
 * and sends reviewer actions (confirm, pick, move, simulate, import) to the store, which re-runs the pipeline.
 * There's no business logic here: every number on screen comes from the engine modules.
 */
(function (HI) {
  "use strict";
  var ui = HI.ui, h = ui.h;

  var TABS = [
    { id: "dashboard", label: "Dashboard" },
    { id: "leads", label: "Leads" },
    { id: "review", label: "Review queue" },
    { id: "candidates", label: "Candidates" },
    { id: "outreach", label: "Outreach drafts" },
    { id: "campaign", label: "Campaign" },
    { id: "followups", label: "Follow-ups & stops" },
    { id: "notes", label: "Data notes" },
    { id: "audit", label: "Audit log" }
  ];
  var state = { tab: "dashboard", industry: "", role: "", showPending: true, leadStatus: "all", flaggedOnly: false, banner: null, openLead: null };
  var $ = function (id) { return document.getElementById(id); };
  var S = null;

  // ---------- shared bits ----------
  function leadByKey(key) { return S.leads.filter(function (l) { return l.key === key; })[0]; }
  function nextStep(l) {
    var steps = l.followups.steps;
    if (!steps.length) return { text: l.eligibility.status === "ineligible" ? "No outreach (ineligible)" : "—", cls: "muted" };
    var s = steps.filter(function (x) { return x.status !== "sent"; })[0];
    if (!s) return { text: "All steps sent", cls: "muted" };
    if (s.status === "due") return { text: "Step " + s.step + " due now (day " + s.day + ")", cls: "ev" };
    if (s.status === "scheduled") return { text: "Step " + s.step + " on day " + s.day, cls: "" };
    if (s.status === "paused") return { text: "Paused: waiting for review", cls: "flag" };
    var stop = l.followups.check.stop;
    return { text: stop ? "Stopped: " + HI.rules.stopEvents[stop.event_type].label.toLowerCase() : "Cancelled: ineligible", cls: "gap" };
  }
  function candidateCell(l) {
    if (l.assignmentNote && l.matches.verified.length) return h("span", { class: "muted", text: l.matches.verified[0].candidate.candidate_id + " released (contact stopped)" });
    if (l.assignment) return h("span", null, h("b", { text: l.assignment.candidate_id }), " ", ui.tag("verified", "synthetic"));
    if (l.blockedBy.length) return h("span", { class: "muted", text: l.blockedBy[0].candidate_id + " assigned to " + l.blockedBy[0].company });
    if (l.matches.verified.length) return h("span", { class: "muted", text: l.matches.verified[0].candidate.candidate_id + " (lead not active)" });
    if (l.matches.partial.length) return h("span", { class: "muted", text: "Partial only (" + l.matches.partial[0].candidate.candidate_id + ")" });
    return h("span", { class: "muted", text: "None" });
  }
  function companyCell(l) {
    return h("span", null, h("b", { text: l.primary.company }), h("br"),
      h("small", { text: l.postingIds.join(" + ") + (l.isDuplicate ? " (linked)" : "") }));
  }
  function stepChips(l) {
    if (!l.followups.steps.length) return h("span", { class: "muted", text: "—" });
    return h("div", { class: "steps" }, l.followups.steps.map(function (s) {
      return h("span", { class: "step " + s.status, title: s.text }, "Step " + s.step + " · day " + s.day + " · " + s.status);
    }));
  }
  function flagList(flags) { return flags && flags.length ? h("ul", { class: "flags" }, flags.map(function (f) { return h("li", { text: f }); })) : null; }

  // ---------- header ----------
  function renderHeader() {
    var c = S.counts;
    var reviewCount = c.needs_check + c.duplicate_check;
    var counts = { leads: c.leads, review: reviewCount, candidates: S.candidates.length, notes: S.notes.length };
    var nav = ui.clear($("tabs"));
    TABS.forEach(function (t) {
      var n = counts[t.id];
      nav.appendChild(h("button", { class: state.tab === t.id ? "on" : null, onclick: function () { go(t.id); }, "aria-current": state.tab === t.id ? "page" : null },
        t.label, n != null ? h("span", { class: "count" + (t.id === "review" && n ? " warn" : ""), text: String(n) }) : null));
    });
    var imported = Object.keys(S.origin).filter(function (k) { return S.origin[k] === "imported"; });
    ui.clear($("source")).appendChild(h("span", null,
      ui.tag("Synthetic data", "synthetic"), " ",
      imported.length ? ui.tag("Imported: " + imported.map(function (k) { return k + " (" + S.sources[k] + ")"; }).join(", "), "assume") : ui.tag("Sample CSVs"),
      " ", ui.tag("Today = day " + S.today, "assume"), " ", ui.tag("Nothing is sent")));
  }

  function go(tab) {
    state.tab = tab;
    try { history.replaceState(null, "", "#" + tab); } catch (e) { /* file:// may block this */ }
    render();
    window.scrollTo(0, 0);
  }

  // ---------- dashboard (R7) ----------
  function filterLead(l) {
    return (!state.industry || l.primary.industry === state.industry) && (!state.role || l.primary.title === state.role);
  }
  function viewDashboard() {
    var industries = uniq(S.leads.map(function (l) { return l.primary.industry; }));
    var roles = uniq(S.leads.map(function (l) { return l.primary.title; }));
    var filtering = !!(state.industry || state.role);
    var leads = S.leads.filter(filterLead);
    var f = filtering ? HI.metrics.funnel(S.events, function (e) { var l = e.leadKey && leadByKey(e.leadKey); return l && filterLead(l); }) : S.funnel;
    var ranked = S.ranked.filter(filterLead).filter(function (l) { return state.showPending || !l.score.pending; })
      .filter(function (l) { return !state.hideStopped || !l.followups.check.stop; });
    var o = f.values.overall;

    var filters = h("div", { class: "filters" },
      h("label", null, "Industry", select(industries, state.industry, "All industries", function (v) { state.industry = v; render(); })),
      h("label", null, "Role", select(roles, state.role, "All roles", function (v) { state.role = v; render(); })),
      h("label", null, h("input", { type: "checkbox", checked: state.showPending ? true : null, onchange: function (e) { state.showPending = e.target.checked; render(); } }), "Show leads waiting for review"),
      h("label", null, h("input", { type: "checkbox", checked: state.hideStopped ? true : null, onchange: function (e) { state.hideStopped = e.target.checked; render(); } }), "Hide stopped contacts"),
      filtering ? h("button", { class: "small", onclick: function () { state.industry = ""; state.role = ""; render(); } }, "Clear filters") : null,
      h("small", { text: "Industry labels are used as given in the CSV (see Data notes)." }));

    var count = function (st) { return leads.filter(function (l) { return l.eligibility.status === st; }).length; };
    var kpis = h("div", { class: "kpis" },
      kpi(leads.length, "Unique leads" + (filtering ? "" : " (from " + S.counts.postings + " postings)")),
      kpi(count("eligible"), "Eligible"),
      kpi(count("needs_check") + count("duplicate_check"), "Waiting for review"),
      kpi(count("ineligible"), "Ineligible"),
      kpi(o.sent, "Messages sent"),
      kpi("≈ " + ui.pct(o.open_rate), "Open rate (approx.)"),
      kpi(o.replied_positive, "Positive replies"),
      kpi(o.client_won, "Clients won"));

    var table = ui.table([
      { label: "#", get: function (l) { return String(ranked.indexOf(l) + 1); }, cls: "num" },
      { label: "Score", get: function (l) { return ui.scoreBar(l.score); }, sort: function (l) { return l.score.total; }, defaultDir: -1 },
      { label: "Company", get: companyCell, sort: function (l) { return l.primary.company; } },
      { label: "Role", get: function (l) { return l.primary.title; }, sort: function (l) { return l.primary.title; } },
      { label: "Industry", get: function (l) { return l.primary.industry; }, sort: function (l) { return l.primary.industry; } },
      { label: "Status", get: function (l) { return ui.status(l.eligibility.status); }, sort: function (l) { return l.eligibility.status; } },
      { label: "Candidate", get: candidateCell },
      { label: "Posted", get: function (l) { return l.primary.posted_days_ago + "d ago"; }, sort: function (l) { return l.primary.posted_days_ago; }, cls: "num" },
      { label: "Next step", get: function (l) { var n = nextStep(l); return h("span", { class: n.cls, text: n.text }); } }
    ], ranked, { onRow: function (l) { openLead(l); }, empty: "No scored leads match these filters." });

    var flagged = S.counts.flaggedSends;
    return [
      intro("Dashboard", "Ranked opportunities, campaign funnel and A/B comparison. Click any lead for its full breakdown: why it scored what it did, candidate evidence, drafts and follow-ups."),
      filters, kpis,
      h("div", { class: "card stack" },
        h("div", { class: "draft-head" }, h("h2", { text: "Ranked opportunities" }),
          h("span", { class: "legend" }, h("span", null, h("i", { style: { background: "var(--e)" } }), "Eligibility /30"), h("span", null, h("i", { style: { background: "var(--f)" } }), "Fit /40"), h("span", null, h("i", { style: { background: "var(--u)" } }), "Urgency /30"))),
        h("p", { class: "muted", text: "Eligible leads rank first. Leads waiting for review are scored for triage but labelled pending. Ineligible leads aren't scored. Click a column header to sort." }),
        table),
      h("div", { class: "grid cols-2", style: { marginTop: "14px" } },
        h("div", { class: "card" }, h("h2", { text: "Campaign funnel" }), h("p", { class: "muted", text: "From events.csv, as recorded" + (filtering ? ", filtered" : "") + ". Unique opens count each message once." }), funnelBars(f)),
        h("div", { class: "card" }, h("h2", { text: "A/B comparison" }), abTable(f, false),
          h("p", { class: "muted", style: { marginTop: "8px" }, text: "A = candidate-first, B = process/speed-first. With about 13 sends per variant, this is far too small to call a winner." }))),
      flagged ? h("div", { class: "banner", style: { marginTop: "14px" } },
        h("b", { text: "⚠ " + flagged + " of " + o.sent + " historical sends broke a rule we now enforce" }),
        " (sent to ineligible or unverified leads, or variant A with no verified candidate). They're counted as recorded. ",
        h("a", { href: "#campaign", onclick: function (e) { e.preventDefault(); go("campaign"); } }, "See the campaign log →")) : null
    ];
  }
  function kpi(v, label) { return h("div", { class: "kpi" }, h("b", { text: String(v) }), h("span", { text: label })); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }
  function select(options, value, allLabel, onchange) {
    return h("select", { onchange: function (e) { onchange(e.target.value); } },
      h("option", { value: "", text: allLabel }),
      options.map(function (o) { return h("option", { value: o, selected: o === value ? true : null, text: o }); }));
  }
  function intro(title, text) { return h("div", { class: "intro" }, h("h2", { text: title }), h("p", { class: "muted", text: text })); }

  function funnelBars(f) {
    var keys = ["sent", "delivered", "unique_opens", "replied_positive", "meeting_booked", "client_won"];
    var max = Math.max(1, f.values.A.sent, f.values.B.sent);
    return h("div", null,
      h("div", { class: "funnel-row" }, h("span"), h("small", { text: "Variant A" }), h("small", { text: "Variant B" })),
      keys.map(function (k) {
        return h("div", { class: "funnel-row" }, h("span", { text: HI.metrics.LABELS[k] }),
          ["A", "B"].map(function (v) {
            var n = f.values[v][k];
            return h("div", { class: "hbar " + v.toLowerCase() }, h("i", { style: { width: (n / max * 100) + "%" } }), h("span", { text: String(n) }));
          }));
      }),
      h("p", { class: "muted", style: { marginTop: "8px" } }, "Also: bounces A " + f.values.A.bounced + " / B " + f.values.B.bounced + " · unsubscribes A " + f.values.A.unsubscribed + " / B " + f.values.B.unsubscribed + "."));
  }

  function abTable(f, withFlags) {
    var rows = HI.metrics.KEYS.map(function (k) { return { k: k }; });
    rows.splice(3, 0, { rate: "open_rate", label: "Open rate (≈ approximate)" });
    rows.push({ rate: "positive_rate", label: "Positive reply rate" });
    var cols = [
      { label: "Metric", get: function (r) { return r.label || HI.metrics.LABELS[r.k]; } },
      { label: "A", cls: "num", get: function (r) { return cell(f, "A", r); } },
      { label: "B", cls: "num", get: function (r) { return cell(f, "B", r); } },
      { label: "Overall", cls: "num", get: function (r) { return cell(f, "overall", r); } }
    ];
    if (withFlags) {
      cols.push({ label: "⚠ Flagged", cls: "num", get: function (r) { return r.k ? h("span", { class: f.flagged.overall[r.k] ? "flag" : "muted", text: String(f.flagged.overall[r.k]) }) : ""; } });
      cols.push({ label: "Excl. flagged", cls: "num", get: function (r) { return r.k ? String(f.values.overall[r.k] - f.flagged.overall[r.k]) : ""; } });
    }
    return ui.table(cols, rows);
  }
  function cell(f, b, r) {
    if (r.rate) return (r.rate === "open_rate" ? "≈ " : "") + ui.pct(f.values[b][r.rate]);
    return String(f.values[b][r.k]);
  }

  // ---------- leads (R1) ----------
  function viewLeads() {
    var filters = ["all", "eligible", "needs_check", "duplicate_check", "ineligible"];
    var rows = S.leads.filter(function (l) { return state.leadStatus === "all" || l.eligibility.status === state.leadStatus; });
    var dupes = S.leads.filter(function (l) { return l.isDuplicate; });
    return [
      intro("Leads", S.counts.postings + " postings, normalized and deduplicated by company domain + role into " + S.counts.leads + " leads. U.S.-only, on-site and licensed roles are ineligible. Unclear remote eligibility goes to human review rather than being assumed."),
      h("div", { class: "grid cols-2", style: { marginBottom: "14px" } }, dupes.map(function (l) {
        var how = {
          auto: "Postings agree on everything that affects eligibility and matching, so the most recent posting (" + l.primary.posting_id + ") is the record.",
          needs_check: "Postings disagree on " + l.conflicts.map(function (c) { return c.label.toLowerCase(); }).join(" and ") + ", so the group is in Duplicate check. Nothing is assumed.",
          human_pick: "A reviewer picked " + l.primary.posting_id + " as the record.",
          human_ineligible: "A reviewer marked this group ineligible."
        }[l.resolution];
        return h("div", { class: "card soft" }, h("h3", null, "Duplicate group: " + l.primary.company + " · " + l.primary.title),
          h("p", null, h("b", { text: l.postingIds.join(" + ") }), " → 1 lead. ", how),
          l.differences.length ? h("small", { text: "Also differ (information only): " + l.differences.map(function (d) { return d.label.toLowerCase(); }).join(", ") + "." }) : null);
      })),
      h("div", { class: "chips", style: { marginBottom: "10px" } }, filters.map(function (s) {
        var n = s === "all" ? S.leads.length : S.leads.filter(function (l) { return l.eligibility.status === s; }).length;
        return h("button", { class: state.leadStatus === s ? "on" : null, onclick: function () { state.leadStatus = s; render(); } }, (s === "all" ? "All" : ui.STATUS[s].label) + " (" + n + ")");
      })),
      ui.table([
        { label: "Company", get: companyCell, sort: function (l) { return l.primary.company; } },
        { label: "Role", get: function (l) { return l.primary.title; }, sort: function (l) { return l.primary.title; } },
        { label: "Industry", get: function (l) { return l.primary.industry; }, sort: function (l) { return l.primary.industry; } },
        { label: "Remote", get: function (l) { return l.primary.remote_policy; }, sort: function (l) { return l.primary.remote_policy; } },
        { label: "U.S. hrs", get: function (l) { return l.primary.us_hours_required; } },
        { label: "Status", get: function (l) { return ui.status(l.eligibility.status); }, sort: function (l) { return l.eligibility.status; } },
        { label: "Why", get: function (l) { return h("span", null, l.eligibility.reasons.join("; ")); } },
        { label: "Score", get: function (l) { return ui.scoreBar(l.score); }, sort: function (l) { return l.score ? l.score.total : -1; }, defaultDir: -1 }
      ], rows, { onRow: openLead, rowClass: function (l) { return l.eligibility.status === "ineligible" ? "dim" : null; } })
    ];
  }

  // ---------- review queue (R1.2, R1.3) ----------
  function viewReview() {
    var dup = S.leads.filter(function (l) { return l.eligibility.status === "duplicate_check"; });
    var chk = S.leads.filter(function (l) { return l.eligibility.status === "needs_check"; });
    var done = S.leads.filter(function (l) { return l.eligibility.humanDecision || l.resolution === "human_pick" || l.resolution === "human_ineligible"; });
    return [
      intro("Review queue", "Leads the rules won't decide on their own. Nothing here gets drafts or follow-ups until a person decides. Every decision is recorded in the audit log and can be undone."),
      h("h3", null, "Duplicate check (" + dup.length + ")"),
      h("p", { class: "muted", text: "Linked postings disagree on something that affects eligibility or matching. Pick the record to use, or mark the group ineligible." }),
      dup.length ? h("div", { class: "stack" }, dup.map(dupCard)) : h("p", { class: "muted", text: "Nothing waiting." }),
      h("h3", { style: { marginTop: "22px" } }, "Needs human check (" + chk.length + ")"),
      h("p", { class: "muted", text: "Eligibility is unclear, so we don't assume these leads qualify. Confirm them only after checking that the employer will hire outside the U.S." }),
      chk.length ? h("div", { class: "grid cols-2" }, chk.map(checkCard)) : h("p", { class: "muted", text: "Nothing waiting." }),
      h("h3", { style: { marginTop: "22px" } }, "Reviewed (" + done.length + ")"),
      done.length ? ui.table([
        { label: "Lead", get: companyCell },
        { label: "Decision", get: function (l) { return l.eligibility.reasons[0]; } },
        { label: "Now", get: function (l) { return ui.status(l.eligibility.status); } },
        { label: "", get: function (l) {
          return h("button", { class: "small", onclick: function (e) {
            e.stopPropagation();
            if (l.resolution === "human_pick" || l.resolution === "human_ineligible") { HI.store.setDuplicate(l, null); if (l.eligibility.humanDecision) HI.store.setCheck(l, null); }
            else HI.store.setCheck(l, null);
          } }, "Undo");
        } }
      ], done) : h("p", { class: "muted", text: "No decisions yet." })
    ];
  }
  function historyWarning(l) {
    var sends = l.history.filter(function (e) { return e.event_type === "sent" && !e.simulated; });
    if (!sends.length) return null;
    return h("p", { class: "flag", text: "History: " + sends.length + " send(s) already went out before review (" + sends.map(function (e) { return e.event_id; }).join(", ") + ")." + (l.followups.check.stop ? " Contact has since: " + HI.rules.stopEvents[l.followups.check.stop.event_type].label.toLowerCase() + "." : "") });
  }
  function dupCard(l) {
    var fields = [
      ["posting_id", "Posting"], ["posted_days_ago", "Posted (days ago)"], ["remote_policy", "Remote policy"], ["us_hours_required", "U.S. hours required"],
      ["required_skills_display", "Required skills"], ["company_employees", "Employees"], ["salary_usd_per_year", "Salary (USD/yr)"], ["notes", "Notes"]
    ];
    var conflictFields = l.conflicts.map(function (c) { return c.field === "required_skills" ? "required_skills_display" : c.field; });
    var grid = h("div", { class: "compare", style: { gridTemplateColumns: "150px repeat(" + l.postings.length + ", minmax(0, 1fr))" } });
    fields.forEach(function (f) {
      grid.appendChild(h("div", { class: "k", text: f[1] }));
      l.postings.forEach(function (p) {
        var v = p[f[0]]; if (Array.isArray(v)) v = v.join("; ");
        grid.appendChild(h("div", { class: conflictFields.indexOf(f[0]) >= 0 ? "diff" : null, text: (v == null ? "—" : String(v)) + (f[0] === "posting_id" && p === l.postings[0] ? " (most recent)" : "") }));
      });
    });
    return h("div", { class: "card review" },
      h("div", { class: "draft-head" }, h("h3", null, l.primary.company + " · " + l.primary.title), ui.status("duplicate_check")),
      h("ul", { class: "flags" }, l.eligibility.reasons.map(function (r) { return h("li", { text: r }); })),
      grid,
      historyWarning(l),
      h("div", { class: "btns" },
        l.postings.map(function (p) { return h("button", { onclick: function () { HI.store.setDuplicate(l, p.posting_id); } }, "Use " + p.posting_id + " as the record"); }),
        h("button", { onclick: function () { HI.store.setDuplicate(l, "ineligible"); } }, "Mark ineligible"),
        h("button", { class: "small", onclick: function () { openLead(l); } }, "Details")));
  }
  function checkCard(l) {
    return h("div", { class: "card review" },
      h("div", { class: "draft-head" }, h("h3", null, l.primary.company + " · " + l.primary.title), ui.scoreBar(l.score)),
      h("small", { text: l.postingIds.join(" + ") + " · " + l.primary.domain + " · " + l.primary.industry }),
      h("p", { style: { marginTop: "6px" } }, h("b", { text: "Why it's here: " }), l.eligibility.reasons.join("; ")),
      h("p", { class: "muted", text: l.matches.verified.length ? "Verified candidate exists: " + l.matches.verified.map(function (m) { return m.candidate.candidate_id; }).join(", ") : (l.matches.partial.length ? "Partial match only: " + l.matches.partial[0].candidate.candidate_id + " (" + l.matches.partial[0].gaps.join("; ") + ")" : "No candidate match") }),
      historyWarning(l),
      h("div", { class: "btns" },
        h("button", { class: "primary", onclick: function () { HI.store.setCheck(l, "eligible"); } }, "Confirm eligible"),
        h("button", { onclick: function () { HI.store.setCheck(l, "ineligible"); } }, "Mark ineligible"),
        h("button", { class: "small", onclick: function () { openLead(l); } }, "Details")));
  }

  // ---------- candidates (R3) ----------
  function viewCandidates() {
    var moves = HI.store.decisions().moves;
    return [
      intro("Candidates", "Each candidate is offered to one lead at a time. Leads stopped by a negative reply, bounce or unsubscribe don't hold a candidate. A lead that replied positively keeps theirs. Otherwise the highest score wins. A recruiter can move a candidate, and the move is logged."),
      h("div", { class: "grid cols-2" }, S.profiles.map(function (p) {
        var c = p.candidate;
        return h("div", { class: "card" },
          h("div", { class: "draft-head" }, h("h3", null, c.candidate_id + " · " + c.role_specialty), ui.tag("Synthetic data", "synthetic")),
          h("p", { class: "muted", text: "Skills: " + c.skills_display.join(", ") }),
          h("p", null,
            c.available_now === "yes" ? h("span", { class: "badge ok", text: "Available now" }) : h("span", { class: "badge bad", text: "Not available now" }), " ",
            c.us_hours_available === "yes" ? h("span", { class: "badge ok", text: "Can work U.S. hours" }) : h("span", { class: "badge no", text: "No U.S. hours" })),
          h("p", null, h("b", { text: "Assigned to: " }), p.assignedTo ? p.assignedTo.primary.company + " (" + p.assignedTo.primary.posting_id + ") · " + ({ reply: "they replied positively", score: "highest score", moved: "moved by a recruiter" })[p.via] : "no lead",
            moves[c.candidate_id] ? h("button", { class: "small", style: { marginLeft: "8px" }, onclick: function () { HI.store.clearMove(c.candidate_id); } }, "Undo move") : null),
          p.fits.length ? ui.table([
            { label: "Lead", get: function (x) { return companyCell(x.lead); } },
            { label: "Match", get: function (x) { return x.verified ? h("span", { class: "badge ok", text: "Verified" }) : h("span", { class: "badge warn", text: "Partial: " + x.match.matched.length + "/" + (x.match.matched.length + x.match.missing.length) }); } },
            { label: "Lead status", get: function (x) { return ui.status(x.lead.eligibility.status); } },
            { label: "Score", get: function (x) { return x.lead.score ? String(x.lead.score.total) : "—"; }, cls: "num" },
            { label: "", get: function (x) {
              var l = x.lead;
              if (p.assignedTo === l) return h("span", { class: "ev", text: "✓ assigned" });
              if (x.verified && l.eligibility.status === "eligible" && !l.assignmentNote)
                return h("button", { class: "small", onclick: function (e) { e.stopPropagation(); HI.store.move(c.candidate_id, l); } }, "Move here");
              return h("small", { text: x.verified ? (l.assignmentNote ? "contact stopped" : "not eligible yet") : (x.match.gaps[0] || "") });
            } }
          ], p.fits, { onRow: function (x) { openLead(x.lead); } }) : h("p", { class: "muted", text: "Not a match for any lead." }));
      }))
    ];
  }

  // ---------- outreach (R4) ----------
  function draftsBlock(l) {
    var d = l.drafts;
    if (!d.eligible) return h("p", { class: "unavailable", text: d.reason });
    return h("div", { class: "grid cols-2" }, ["A", "B"].map(function (v) {
      var x = d[v];
      var title = v === "A" ? "Variant A · candidate-first" : "Variant B · process/speed-first";
      if (!x.available) return h("div", null, h("h3", { text: title }), h("div", { class: "unavailable", text: "Variant A unavailable. " + x.reason }));
      return h("div", null,
        h("div", { class: "draft-head" }, h("h3", { text: title }), h("small", { text: x.words + " words" + (x.warning ? " · ⚠ " + x.warning : "") })),
        h("div", { class: "draft" }, h("b", { text: "Subject: " + x.subject }), "\n\n" + x.body),
        h("small", { text: "Claims checked against the data: " + x.claims.join(" · ") }));
    }));
  }
  function viewOutreach() {
    var leads = S.ranked.filter(function (l) { return l.eligibility.status === "eligible"; });
    return [
      intro("Outreach drafts", "Two first-contact drafts per eligible lead. A is only written when a verified candidate is assigned to that lead. It never invents one. Nothing is sent: in production these would go to Apollo sequences, and the stop check would run right before each send."),
      h("div", { class: "banner info", text: "Drafts written for " + leads.length + " eligible leads. " + (S.counts.needs_check + S.counts.duplicate_check) + " leads get drafts after review; " + S.counts.ineligible + " ineligible leads get none." }),
      h("div", { class: "stack" }, leads.map(function (l) {
        var fu = l.followups;
        return h("div", { class: "card" },
          h("div", { class: "draft-head" }, h("h2", null, l.primary.company + " · " + l.primary.title), ui.scoreBar(l.score)),
          h("p", { class: "muted" }, l.postingIds.join(" + ") + " · " + (fu.contacted ? "In campaign: variant " + fu.variant + ", step 1 already sent." : "Not contacted yet.") + " ",
            h("span", { class: fu.check.ok ? "ev" : "gap", text: fu.check.ok ? "✓ " + fu.check.reason : "✕ " + fu.check.reason })),
          draftsBlock(l));
      }))
    ];
  }

  // ---------- campaign (R5) ----------
  function viewCampaign() {
    var f = S.funnel;
    var events = S.events.filter(function (e) { return !e.simulated; }).filter(function (e) { return !state.flaggedOnly || e.flags.length; });
    var leadOf = function (e) { return e.leadKey ? leadByKey(e.leadKey) : null; };
    return [
      intro("Campaign", "Mock campaign activity from events.csv, by variant and overall. History is reported exactly as recorded. Events that broke a rule we now enforce are counted, with a ⚠ count beside each total."),
      h("div", { class: "grid cols-2" },
        h("div", { class: "card" }, h("h2", { text: "Funnel by variant" }), abTable(f, true),
          h("ul", { class: "plain muted", style: { marginTop: "8px" } },
            h("li", { text: "Unique opens count each message (posting + step) once: " + f.values.overall.raw_opens + " open events → " + f.values.overall.unique_opens + " unique." }),
            h("li", { text: "Open rate = unique opens ÷ delivered. It's approximate: tracking misses some opens (a reply arrived with no recorded open)." }),
            h("li", { text: "Contact = company domain. That's an assumption: the data has no contact column." }))),
        h("div", { class: "card" }, h("h2", { text: "Why sends are flagged" }),
          h("ul", { class: "plain" }, summarizeFlags().map(function (x) { return h("li", null, h("b", { text: String(x.n) }), " × " + x.text); })),
          h("p", { class: "muted", text: "The flags use today's rules on yesterday's sends. The app now blocks all of these: no drafts for ineligible or unreviewed leads, and no variant A without a verified, assigned candidate." }))),
      h("div", { class: "draft-head", style: { marginTop: "18px" } }, h("h2", { text: "Event log" }),
        h("div", { class: "chips" },
          h("button", { class: !state.flaggedOnly ? "on" : null, onclick: function () { state.flaggedOnly = false; render(); } }, "All events"),
          h("button", { class: state.flaggedOnly ? "on" : null, onclick: function () { state.flaggedOnly = true; render(); } }, "⚠ Flagged only"))),
      ui.table([
        { label: "Event", get: function (e) { return e.event_id; }, sort: function (e) { return e.order; } },
        { label: "Day", get: function (e) { return String(e.event_day); }, sort: function (e) { return e.event_day; }, cls: "num" },
        { label: "Posting", get: function (e) { var l = leadOf(e); return h("span", null, e.posting_id, h("br"), h("small", { text: l ? l.primary.company : "unknown" })); }, sort: function (e) { return e.posting_id; } },
        { label: "Var.", get: function (e) { return e.variant; }, sort: function (e) { return e.variant; } },
        { label: "Step", get: function (e) { return String(e.step); }, cls: "num" },
        { label: "Type", get: function (e) { return e.event_type; }, sort: function (e) { return e.event_type; } },
        { label: "Lead status now", get: function (e) { var l = leadOf(e); return l ? ui.status(l.eligibility.status) : ""; } },
        { label: "Flags", get: function (e) { return flagList(e.flags) || ""; } }
      ], events, { onRow: function (e) { var l = leadOf(e); if (l) openLead(l); } })
    ];
  }
  function summarizeFlags() {
    var counts = {};
    S.events.forEach(function (e) {
      if (e.event_type !== "sent" || e.simulated) return;
      e.flags.forEach(function (f) { var k = f.replace(/ \(.*\)$/, ""); counts[k] = (counts[k] || 0) + 1; });
    });
    return Object.keys(counts).map(function (k) { return { text: k, n: counts[k] }; }).sort(function (a, b) { return b.n - a.n; });
  }

  // ---------- follow-ups & stops (R6) ----------
  function viewFollowups() {
    var seq = HI.rules.sequence.map(function (s) { return "step " + s.step + (s.offsetDays ? " on day +" + s.offsetDays : " on day 0"); }).join(", ");
    var withSteps = S.leads.filter(function (l) { return l.followups.steps.length; })
      .sort(function (a, b) { return order(a) - order(b) || a.primary.posting_id.localeCompare(b.primary.posting_id); });
    var sims = HI.store.decisions().simEvents;
    return [
      intro("Follow-ups & stop rules", "Sequence (matches the history in events.csv): " + seq + ". There's no step 3 because the history never sends one. Any reply, bounce or unsubscribe stops every pending step for that contact (company domain), including linked postings. The stop check runs right before every send."),
      h("div", { class: "card" }, h("h2", { text: "Stop-rule log" }), h("p", { class: "muted", text: "Every stop event in the data, and the pending follow-ups it cancelled." }),
        ui.table([
          { label: "Day", get: function (r) { return String(r.event.event_day); }, cls: "num" },
          { label: "Event", get: function (r) { return h("span", null, h("b", { text: HI.rules.stopEvents[r.event.event_type].label }), h("br"), h("small", { text: r.event.event_id + " on " + r.event.posting_id + (r.event.simulated ? " (simulated)" : "") })); } },
          { label: "Contact", get: function (r) { return h("span", null, r.company, h("br"), h("small", { text: r.domain })); } },
          { label: "Covers postings", get: function (r) { return r.postings.join(" + "); } },
          { label: "Outcome", get: function (r) { return r.outcome; } },
          { label: "Pending steps cancelled", get: function (r) { return r.firstStop ? (r.cancelled.length ? r.cancelled.join(", ") : "none pending") : h("small", { text: "already stopped by an earlier event" }); } }
        ], S.stopLog)),
      h("div", { class: "card", style: { marginTop: "14px" } }, h("h2", { text: "Follow-up schedule (today = day " + S.today + ")" }),
        ui.table([
          { label: "Lead", get: companyCell },
          { label: "Status", get: function (l) { return ui.status(l.eligibility.status); } },
          { label: "Variant", get: function (l) { return l.followups.variant || "—"; } },
          { label: "Steps", get: stepChips },
          { label: "Stop check", get: function (l) { var c = l.followups.check; return h("span", { class: c.ok ? "ev" : (c.kind === "paused" ? "flag" : "gap"), text: c.reason }); } }
        ], withSteps, { onRow: openLead })),
      h("div", { class: "card", style: { marginTop: "14px" } }, h("h2", { text: "Try it: simulate an event" }),
        h("p", { class: "muted", text: "Add a what-if reply, bounce or unsubscribe and watch the schedule and stop log update. Simulated events only affect stop rules. They never change the campaign numbers." }),
        simForm(),
        sims.length ? h("div", { style: { marginTop: "10px" } },
          h("p", null, h("b", { text: "Simulated: " }), sims.map(function (s, i) { return "SIM-" + (i + 1) + " " + s.event_type + " on " + s.posting_id + " (day " + s.event_day + ")"; }).join(" · ")),
          h("button", { class: "small", onclick: function () { HI.store.clearSims(); } }, "Clear simulated events")) : null)
    ];
  }
  function order(l) { var s = l.followups.steps.filter(function (x) { return x.status !== "sent"; })[0]; return s ? { due: 0, scheduled: 1, paused: 2, cancelled: 3 }[s.status] : 4; }
  function simForm() {
    var leads = S.leads.slice().sort(function (a, b) { return a.primary.posting_id.localeCompare(b.primary.posting_id); });
    var selLead = h("select", null, leads.map(function (l) { return h("option", { value: l.primary.posting_id, text: l.primary.posting_id + " · " + l.primary.company + (l.followups.check.ok ? "" : " (" + l.followups.check.kind + ")") }); }));
    var due = leads.filter(function (l) { return l.followups.check.ok; })[0];
    if (due) selLead.value = due.primary.posting_id;
    var selType = h("select", null, Object.keys(HI.rules.stopEvents).map(function (k) { return h("option", { value: k, text: HI.rules.stopEvents[k].label }); }));
    var day = h("input", { type: "number", min: "0", max: "365", value: String(S.today), style: { width: "80px" } });
    return h("div", { class: "filters" },
      h("label", null, "Lead", selLead), h("label", null, "Event", selType), h("label", null, "Day", day),
      h("button", { class: "primary", onclick: function () {
        var d = parseInt(day.value, 10);
        HI.store.addSim({ posting_id: selLead.value, event_type: selType.value, event_day: isFinite(d) ? d : S.today });
      } }, "Add simulated event"));
  }

  // ---------- data notes + audit ----------
  function viewNotes() {
    var areas = uniq(S.notes.map(function (n) { return n.area; }));
    return [
      intro("Data notes", "Things a person should know about the data. Nothing here is corrected automatically. Noisy industry labels, for example, are flagged but filters still use them as given."),
      h("div", { class: "card soft", style: { marginBottom: "14px" } }, h("h3", { text: "Loaded files" }),
        h("ul", { class: "plain" }, ["jobs", "candidates", "events"].map(function (k) {
          return h("li", null, h("b", { text: k + ": " }), S.sources[k] + " (" + S.origin[k] + ") · " + ({ jobs: S.jobs.length, candidates: S.candidates.length, events: S.events.filter(function (e) { return !e.simulated; }).length })[k] + " rows loaded");
        }))),
      areas.length ? h("div", { class: "stack" }, areas.map(function (a) {
        return h("div", { class: "card" }, h("h3", { text: a }), h("ul", { class: "plain" }, S.notes.filter(function (n) { return n.area === a; }).map(function (n) { return h("li", { text: n.text }); })));
      })) : h("p", { class: "muted", text: "No data issues found." })
    ];
  }
  function viewAudit() {
    var log = HI.store.decisions().audit;
    return [
      intro("Audit log", "Every reviewer decision, candidate move, import and simulation, newest first. It's stored in this browser only; in production it would be a database table."),
      ui.table([
        { label: "When", get: function (r) { return new Date(r.at).toLocaleString(); } },
        { label: "Action", get: function (r) { return r.action; } },
        { label: "Detail", get: function (r) { return r.detail; } }
      ], log, { empty: "No actions yet. Try the Review queue." })
    ];
  }

  // ---------- lead detail dialog ----------
  function openLead(l) { state.openLead = l.key; renderDialog(); var d = $("lead-dialog"); if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); } }
  function renderDialog() {
    var d = $("lead-dialog"), l = state.openLead && leadByKey(state.openLead);
    if (!l) { if (d.open) d.close(); return; }
    var p = l.primary;
    var sc = l.score;
    ui.clear(d).appendChild(h("div", null,
      h("div", { class: "dlg-head" },
        h("div", null, h("h2", null, p.company + " · " + p.title), h("small", { text: l.postingIds.join(" + ") + " · " + p.domain + " · " + p.industry + " · " + (p.company_employees || "?") + " employees · $" + (p.salary_usd_per_year || "?") + "/yr (context only, not scored)" })),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, ui.status(l.eligibility.status), h("button", { onclick: function () { d.close(); }, "aria-label": "Close" }, "Close"))),
      h("div", { class: "dlg-body" },
        h("section", null, h("h3", { text: "Eligibility" + (l.isDuplicate ? " & duplicates" : "") }),
          h("ul", { class: "plain" }, l.eligibility.reasons.map(function (r) { return h("li", { text: r }); })),
          h("dl", { class: "kv" }, h("dt", { text: "Remote policy" }), h("dd", { text: p.remote_policy }), h("dt", { text: "U.S. hours required" }), h("dd", { text: p.us_hours_required }),
            h("dt", { text: "Required skills" }), h("dd", { text: p.required_skills_display.join(", ") }), h("dt", { text: "Notes" }), h("dd", { text: p.notes || "—" })),
          l.isDuplicate ? h("p", { class: "muted", style: { marginTop: "6px" }, text: "Linked postings: " + l.postings.map(function (x) { return x.posting_id + " (" + x.posted_days_ago + "d ago)"; }).join(", ") + ". Primary record: " + p.posting_id + "." + (l.differences.length ? " Also differ (information only): " + l.differences.map(function (x) { return x.label.toLowerCase() + " " + x.values.map(function (v) { return v.value; }).join(" vs "); }).join("; ") + "." : "") }) : null,
          l.eligibility.status === "needs_check" ? h("div", { class: "btns" }, h("button", { class: "primary", onclick: function () { HI.store.setCheck(l, "eligible"); } }, "Confirm eligible"), h("button", { onclick: function () { HI.store.setCheck(l, "ineligible"); } }, "Mark ineligible")) : null),
        h("section", null, h("h3", { text: "Priority score" }),
          sc ? h("div", { class: "parts" },
            h("div", { class: "part" }, h("span", { text: "Total" }), h("b", { text: sc.total + " / 100" }), sc.pending ? h("span", { class: "flag", text: "Pending: score is for triage until a person reviews this lead" }) : h("span")),
            ["eligibility", "fit", "urgency"].map(function (k) {
              var part = sc.parts[k];
              return h("div", { class: "part" }, h("span", { text: { eligibility: "Remote eligibility", fit: "Candidate fit", urgency: "Urgency" }[k] }), h("b", { text: part.points + " / " + part.max }),
                k === "urgency" && part.items.length ? h("ul", { class: "plain", style: { margin: 0 } }, part.items.map(function (i) { return h("li", { text: "+" + i.points + " " + i.label }); })) : h("span", { text: part.reason }));
            })) : h("p", { class: "muted", text: "Not scored: ineligible leads aren't ranked." })),
        h("section", null, h("div", { class: "draft-head" }, h("h3", { text: "Candidate matches" }), ui.tag("Synthetic data", "synthetic")),
          l.assignment ? h("p", { class: "ev", text: "Assigned: " + l.assignment.candidate_id + ". " + l.assignment.text + "." }) : null,
          l.blockedBy.length ? h("p", { class: "flag", text: l.blockedBy.map(function (b) { return b.candidate_id + " is a verified match but is assigned to " + b.company + " (" + b.posting_id + ")"; }).join("; ") + ". Use variant B or move the candidate on the Candidates tab." }) : null,
          l.assignmentNote ? h("p", { class: "muted", text: l.assignmentNote }) : null,
          matchList(l.matches.verified, "Verified"), matchList(l.matches.partial, "Partial: not verified"),
          !l.matches.verified.length && !l.matches.partial.length ? h("p", { class: "muted", text: "No candidate has any required skill." }) : null,
          l.matches.partialTotal > l.matches.partial.length ? h("small", { text: "Showing the best " + l.matches.partial.length + " of " + l.matches.partialTotal + " partial matches." }) : null),
        h("section", null, h("h3", { text: "Outreach drafts" }), draftsBlock(l)),
        h("section", null, h("h3", { text: "Follow-ups" }), stepChips(l),
          h("p", { class: l.followups.check.ok ? "ev" : "gap", style: { marginTop: "6px" }, text: l.followups.check.reason })),
        h("section", null, h("h3", { text: "Campaign history" }),
          l.history.length ? ui.table([
            { label: "Event", get: function (e) { return e.event_id + (e.simulated ? " (sim)" : ""); } },
            { label: "Day", get: function (e) { return String(e.event_day); }, cls: "num" },
            { label: "Posting", get: function (e) { return e.posting_id; } },
            { label: "Var.", get: function (e) { return e.variant || "—"; } },
            { label: "Step", get: function (e) { return String(e.step); } },
            { label: "Type", get: function (e) { return e.event_type; } },
            { label: "Flags", get: function (e) { return flagList(e.flags) || ""; } }
          ], l.history) : h("p", { class: "muted", text: "Never contacted." })))));
  }
  function matchList(list, label) {
    if (!list.length) return null;
    return h("div", { style: { marginTop: "8px" } }, list.map(function (m) {
      return h("div", { class: "card soft", style: { marginBottom: "8px" } },
        h("div", { class: "draft-head" }, h("b", { text: m.candidate.candidate_id + " · " + m.candidate.role_specialty }), h("span", { class: "badge " + (m.verified ? "ok" : "warn"), text: label })),
        h("ul", { class: "plain checks" }, m.evidence.map(function (x) { return h("li", { class: "ev", text: "✓ " + x }); }), m.gaps.map(function (x) { return h("li", { class: "gap", text: "✕ " + x }); })));
    }));
  }

  // ---------- import ----------
  function onImport(files) {
    var list = Array.prototype.slice.call(files || []);
    var messages = [], errors = [];
    var next = Promise.resolve();
    list.forEach(function (file) {
      next = next.then(function () {
        return HI.sources.readFile(file).then(function (text) {
          var kind = HI.sources.detectKind(text);
          if (!kind) throw new Error(file.name + ": couldn't tell if this is a jobs, candidates or events file. Check the header row against README → Data format.");
          HI.store.importText(kind, text, file.name);
          messages.push(file.name + " → " + kind);
        }).catch(function (e) { errors.push(e.message); });
      });
    });
    next.then(function () {
      state.banner = errors.length ? { cls: "error", text: (messages.length ? "Imported " + messages.join(", ") + ". " : "") + "Not imported: " + errors.join(" · ") }
        : { cls: "info", text: "Imported " + messages.join(", ") + ". Every view has been recalculated." };
      $("import-file").value = "";
      render();
    });
  }

  // ---------- render ----------
  function render() {
    S = HI.store.snapshot();
    renderHeader();
    var main = ui.clear($("main"));
    if (state.banner) main.appendChild(h("div", { class: "banner " + state.banner.cls }, state.banner.text, " ", h("button", { class: "small", onclick: function () { state.banner = null; render(); } }, "Dismiss")));
    var views = { dashboard: viewDashboard, leads: viewLeads, review: viewReview, candidates: viewCandidates, outreach: viewOutreach, campaign: viewCampaign, followups: viewFollowups, notes: viewNotes, audit: viewAudit };
    var sec = h("section", { class: "view" });
    [].concat(views[state.tab]()).forEach(function (n) { if (n) sec.appendChild(n); });
    main.appendChild(sec);
    if ($("lead-dialog").open) renderDialog();
  }

  function start() {
    var hash = (location.hash || "").slice(1);
    if (TABS.some(function (t) { return t.id === hash; })) state.tab = hash;
    $("import-btn").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function (e) { onImport(e.target.files); });
    $("sample-btn").addEventListener("click", function () { HI.store.loadSample(); state.banner = { cls: "info", text: "Sample data reloaded." }; render(); });
    $("reset-btn").addEventListener("click", function () {
      if (window.confirm("Reset all reviewer decisions, candidate moves and simulated events? The audit log is kept.")) { HI.store.resetDecisions(); }
    });
    $("lead-dialog").addEventListener("close", function () { state.openLead = null; });
    HI.store.onChange(function () { render(); });
    try { HI.store.init(); }
    catch (e) {
      ui.clear($("main")).appendChild(h("div", { class: "banner error", text: "The data couldn't be processed: " + e.message }));
    }
  }

  document.addEventListener("DOMContentLoaded", start);
})(this.HI = this.HI || {});
