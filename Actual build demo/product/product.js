/*
 * product.js: the App-product UI (dashboard only). It renders the same snapshot from pipeline.run()
 * that the Actual build demo uses, so every number matches. There's no business logic here.
 * Data is only ever inserted as text (HI.ui.h → textContent), never as HTML.
 */
(function (HI) {
  "use strict";
  var h = HI.ui.h, clear = HI.ui.clear;
  var $ = function (id) { return document.getElementById(id); };

  var STATUS_LABEL = { eligible: "Eligible", needs_check: "Needs verification", duplicate_check: "Needs verification", ineligible: "Ineligible" };
  var state = { tab: "opportunities", industry: "", role: "", includePending: false, leadFilter: "all", drawer: null, cand: null, variant: "A", sort: "score",
    cf: { specialty: "", available: "", hours: "", assigned: "" } };
  var S = null;

  // ---------- helpers ----------
  function leadByKey(k) { return S.leads.filter(function (l) { return l.key === k; })[0]; }
  function inFilter(l) { return (!state.industry || l.primary.industry === state.industry) && (!state.role || l.primary.title === state.role); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort(); }
  function pct(x) { return x == null ? "—" : Math.round(x * 100) + "%"; }
  function status(l) { var s = l.eligibility.status; return h("span", { class: "status " + s, text: STATUS_LABEL[s] }); }
  function company(l, extra) {
    return h("div", { class: "co" }, h("b", { text: l.primary.company }), h("div", { text: l.primary.title + (extra ? " · " + extra : "") }));
  }
  function scoreEl(sc) {
    if (!sc) return h("span", { class: "faint", text: "—" });
    var p = sc.parts;
    return h("span", { class: "score" + (sc.pending ? " pending" : ""), title: "Eligibility " + p.eligibility.points + " · Fit " + p.fit.points + " · Urgency " + p.urgency.points },
      h("b", { text: String(sc.total) }),
      h("span", { class: "bar" }, h("i", { class: "e", style: { width: p.eligibility.points + "%" } }), h("i", { class: "f", style: { width: p.fit.points + "%" } }), h("i", { class: "u", style: { width: p.urgency.points + "%" } })));
  }
  function candidateEl(l) {
    if (l.assignment) return h("span", { class: "pill ok", text: l.assignment.candidate_id + " · verified" });
    if (l.assignmentNote && l.matches.verified.length) return h("span", { class: "pill", text: "Released: contact stopped" });
    if (l.blockedBy.length) return h("span", { class: "pill warn", text: l.blockedBy[0].candidate_id + " assigned elsewhere" });
    if (l.matches.verified.length) return h("span", { class: "pill", text: l.matches.verified[0].candidate.candidate_id + " · after verification" });
    if (l.matches.partial.length) return h("span", { class: "pill", text: "Partial only" });
    return h("span", { class: "faint", text: "No match" });
  }
  function nextStep(l) {
    var steps = l.followups.steps;
    if (!steps.length) return { text: "Not contacted", cls: "muted" };
    var s = steps.filter(function (x) { return x.status !== "sent"; })[0];
    if (!s) return { text: "All emails sent", cls: "muted" };
    if (s.status === "due") return { text: (s.step === 1 ? "First email" : "Follow-up") + " due now", cls: "due" };
    if (s.status === "scheduled") return { text: "Email " + s.step + " on day " + s.day, cls: "" };
    if (s.status === "paused") return { text: "Paused: needs verification", cls: "paused" };
    var st = l.followups.check.stop;
    return { text: st ? "Stopped: " + HI.rules.stopEvents[st.event_type].label.toLowerCase() : "Cancelled: ineligible", cls: "stopped" };
  }
  function kpi(v, l) { return h("div", { class: "kpi" }, h("div", { class: "v", text: String(v) }), h("div", { class: "l", text: l })); }
  function card(title, aside, body) {
    return h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { text: title }), aside ? h("span", null, aside) : null), h("div", { class: "card-body" }, body));
  }
  function select(options, value, all, onchange) {
    return h("select", { onchange: function (e) { onchange(e.target.value); }, "aria-label": all },
      h("option", { value: "", text: all }), options.map(function (o) { return h("option", { value: o, selected: o === value ? true : null, text: o }); }));
  }
  function filterBar(extra) {
    return h("div", { class: "filters" },
      select(uniq(S.leads.map(function (l) { return l.primary.industry; })), state.industry, "All industries", function (v) { state.industry = v; render(); }),
      select(uniq(S.leads.map(function (l) { return l.primary.title; })), state.role, "All roles", function (v) { state.role = v; render(); }),
      extra || null,
      (state.industry || state.role) ? h("button", { class: "btn ghost small", onclick: function () { state.industry = ""; state.role = ""; render(); } }, "Clear") : null);
  }
  function pageHead(title, sub, right) { return h("div", { class: "page-head" }, h("div", null, h("h1", { text: title }), h("p", { text: sub })), right || null); }
  function table(cols, rows, onRow, empty) {
    if (!rows.length) return h("div", { class: "empty", text: empty || "Nothing to show." });
    return h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, cols.map(function (c) { return h("th", { class: c.cls || null, text: c.label }); }))),
      h("tbody", null, rows.map(function (r, i) {
        return h("tr", { class: onRow ? "click" : null, tabindex: onRow ? "0" : null, onclick: onRow ? function () { onRow(r); } : null,
          onkeydown: onRow ? function (e) { if (e.key === "Enter") onRow(r); } : null },
          cols.map(function (c) { return h("td", { class: c.cls || null }, c.get(r, i)); }));
      }))));
  }

  // ---------- Opportunities ----------
  function viewOpportunities() {
    var leads = S.leads.filter(inFilter);
    var ranked = S.ranked.filter(inFilter).filter(function (l) { return state.includePending || !l.score.pending; });
    if (state.sort === "newest") ranked = ranked.slice().sort(function (a, b) { return a.primary.posted_days_ago - b.primary.posted_days_ago || b.score.total - a.score.total; });
    if (state.sort === "company") ranked = ranked.slice().sort(function (a, b) { return a.primary.company.localeCompare(b.primary.company); });
    var sortSeg = h("div", { class: "seg", "aria-label": "Sort" }, [["score", "Highest score"], ["newest", "Newest posting"], ["company", "Company A–Z"]].map(function (o) {
      return h("button", { class: state.sort === o[0] ? "on" : null, onclick: function () { state.sort = o[0]; render(); } }, o[1]);
    }));
    var due = leads.filter(function (l) { return l.eligibility.status === "eligible" && l.followups.steps.some(function (s) { return s.status === "due"; }); }).length;
    var waiting = leads.filter(function (l) { return l.eligibility.status === "needs_check" || l.eligibility.status === "duplicate_check"; }).length;
    var won = HI.metrics.funnel(S.events, function (e) { var l = e.leadKey && leadByKey(e.leadKey); return l && inFilter(l); }).values.overall.client_won;

    return [
      pageHead("Opportunities", "Eligible leads, ranked by priority score. Click a lead for the full picture.",
        filterBar(h("label", { class: "check" }, h("input", { type: "checkbox", checked: state.includePending ? true : null, onchange: function (e) { state.includePending = e.target.checked; render(); } }), "Include leads awaiting verification"))),
      h("div", { class: "kpis" },
        kpi(leads.filter(function (l) { return l.eligibility.status === "eligible"; }).length, "Eligible leads"),
        kpi(waiting, "Awaiting verification"),
        kpi(due, "Emails due today"),
        kpi(won, "Clients won")),
      card("Ranked opportunities", sortSeg,
        table([
          { label: "Rank", cls: "rank", get: function (l) { return String(S.ranked.indexOf(l) + 1); } },
          { label: "Company", get: function (l) { return company(l, l.primary.industry); } },
          { label: "Score", get: function (l) { return scoreEl(l.score); } },
          { label: "Candidate", cls: "hide-sm", get: candidateEl },
          { label: "Next step", get: function (l) { var n = nextStep(l); return h("span", { class: "next " + n.cls, text: n.text }); } }
        ], ranked, function (l) { openDrawer(l.key); }, "No leads match these filters."))
    ];
  }

  // ---------- Leads ----------
  function viewLeads() {
    var pending = S.leads.filter(function (l) { return (l.eligibility.status === "needs_check" || l.eligibility.status === "duplicate_check") && inFilter(l); });
    var filters = [["all", "All"], ["eligible", "Eligible"], ["waiting", "Needs verification"], ["ineligible", "Ineligible"]];
    var rows = S.leads.filter(inFilter).filter(function (l) {
      var s = l.eligibility.status;
      return state.leadFilter === "all" || (state.leadFilter === "waiting" ? (s === "needs_check" || s === "duplicate_check") : s === state.leadFilter);
    });
    return [
      pageHead("Leads", S.counts.postings + " job postings, normalized and deduplicated into " + S.counts.leads + " leads.", filterBar()),
      pending.length ? card("Needs verification", "Unclear leads wait here. No emails go out until an employee decides.",
        h("div", { class: "review-grid" }, pending.map(reviewCard))) : null,
      h("div", { style: { height: pending.length ? "16px" : "0" } }),
      card("All leads", null, h("div", null,
        h("div", { class: "seg", style: { marginBottom: "12px" } }, filters.map(function (f) {
          return h("button", { class: state.leadFilter === f[0] ? "on" : null, onclick: function () { state.leadFilter = f[0]; render(); } }, f[1]);
        })),
        table([
          { label: "Company", get: function (l) { return company(l, l.postingIds.length > 1 ? l.postingIds.join(" + ") : null); } },
          { label: "Industry", cls: "hide-sm", get: function (l) { return l.primary.industry; } },
          { label: "Status", get: status },
          { label: "Reason", get: function (l) { return h("span", { class: "muted", text: l.eligibility.reasons[0] }); } }
        ], rows, function (l) { openDrawer(l.key); })))
    ];
  }
  function reviewCard(l) {
    var actions;
    if (l.eligibility.status === "duplicate_check") {
      actions = l.postings.map(function (p) {
        return h("button", { class: "btn small", onclick: function () { HI.store.setDuplicate(l, p.posting_id); toast("Using " + p.posting_id + " for " + l.primary.company); } }, "Use " + p.posting_id);
      }).concat([h("button", { class: "btn small", onclick: function () { HI.store.setDuplicate(l, "ineligible"); toast(l.primary.company + " marked ineligible"); } }, "Mark ineligible")]);
    } else {
      actions = [
        h("button", { class: "btn small primary", onclick: function () { HI.store.setCheck(l, "eligible"); toast(l.primary.company + " confirmed eligible"); } }, "Confirm eligible"),
        h("button", { class: "btn small", onclick: function () { HI.store.setCheck(l, "ineligible"); toast(l.primary.company + " marked ineligible"); } }, "Mark ineligible")
      ];
    }
    var cmp = null;
    if (l.eligibility.status === "duplicate_check") {
      cmp = h("div", { class: "cmp", style: { gridTemplateColumns: "auto repeat(" + l.postings.length + ", 1fr)" } },
        h("span", { class: "k" }), l.postings.map(function (p) { return h("b", { text: p.posting_id + (p === l.postings[0] ? " (newest)" : "") }); }),
        l.conflicts.map(function (c) {
          var key = c.field === "required_skills" ? "required_skills" : c.field;
          return [h("span", { class: "k", text: c.label })].concat(l.postings.map(function (p) {
            var v = p[key]; if (Array.isArray(v)) v = v.join(", ");
            return h("span", { class: "diff", text: String(v) });
          }));
        }));
    }
    return h("div", { class: "review" },
      h("h3", { text: l.primary.company }),
      h("div", { class: "muted", style: { fontSize: "13px" }, text: l.primary.title + " · " + l.postingIds.join(" + ") }),
      cmp || h("div", { class: "why", text: l.eligibility.reasons.join(". ") + "." }),
      h("div", { class: "actions" }, actions, h("button", { class: "btn small ghost", onclick: function () { openDrawer(l.key); } }, "Details")));
  }

  // ---------- Campaign ----------
  function viewCampaign() {
    var filtering = !!(state.industry || state.role);
    var f = filtering ? HI.metrics.funnel(S.events, function (e) { var l = e.leadKey && leadByKey(e.leadKey); return l && inFilter(l); }) : S.funnel;
    var o = f.values.overall, A = f.values.A, B = f.values.B;
    var flagged = f.flagged.overall.sent;
    var stages = ["sent", "delivered", "unique_opens", "replied_positive", "meeting_booked", "client_won"];
    var max = Math.max(1, o.sent);

    var funnel = h("div", null,
      h("div", { class: "legend", style: { marginBottom: "6px" } }, h("span", null, h("i", { style: { background: "var(--a)" } }), "Variant A"), h("span", null, h("i", { style: { background: "var(--b)" } }), "Variant B")),
      stages.map(function (k) {
        return h("div", { class: "fun-row" },
          h("span", { class: "lbl", text: HI.metrics.LABELS[k] + (k === "unique_opens" ? " (≈)" : "") }),
          h("div", { class: "fun-bar", title: "A " + A[k] + " · B " + B[k] },
            h("i", { class: "a", style: { width: (A[k] / max * 100) + "%" } }), h("i", { class: "b", style: { width: (B[k] / max * 100) + "%" } })),
          h("span", { class: "n" }, String(o[k]), h("small", { text: "A " + A[k] + " · B " + B[k] })));
      }),
      flagged ? h("div", { class: "note warn", text: "⚠ " + flagged + " of " + o.sent + " sends broke a rule we now enforce (sent to ineligible or unverified leads, or A without a verified candidate). They're counted as recorded." }) : null,
      h("div", { class: "note", text: "Bounces: " + o.bounced + " · Unsubscribes: " + o.unsubscribed + " · Negative replies: " + o.replied_negative + ". Duplicate opens are counted once (" + o.raw_opens + " open events → " + o.unique_opens + " unique)." }));

    var rows = [
      ["Sent", A.sent, B.sent, "n"],
      ["Delivered", A.delivered, B.delivered, "n"],
      ["Bounces", A.bounced, B.bounced, "n"],
      ["Open rate (≈)", A.open_rate, B.open_rate, "p"],
      ["Positive replies", A.replied_positive, B.replied_positive, "n"],
      ["Positive reply rate", A.positive_rate, B.positive_rate, "p"],
      ["Meetings booked", A.meeting_booked, B.meeting_booked, "n"],
      ["Clients won", A.client_won, B.client_won, "n"],
      ["Unsubscribes", A.unsubscribed, B.unsubscribed, "n"]
    ];
    var ab = h("div", null,
      table([
        { label: "", get: function (r) { return r[0]; } },
        { label: "A · candidate-first", cls: "num", get: function (r) { return h("span", { class: r[1] > r[2] && !/Bounces|Unsub|Sent|Delivered/.test(r[0]) ? "ab-win" : null, text: r[3] === "p" ? pct(r[1]) : String(r[1]) }); } },
        { label: "B · process-first", cls: "num", get: function (r) { return h("span", { class: r[2] > r[1] && !/Bounces|Unsub|Sent|Delivered/.test(r[0]) ? "ab-win" : null, text: r[3] === "p" ? pct(r[2]) : String(r[2]) }); } }
      ], rows),
      h("div", { class: "note", text: "About " + Math.round(o.sent / 2) + " emails per variant: far too few to call a winner." }));

    var stops = S.stopLog.filter(function (r) { return r.firstStop; }).filter(function (r) { var l = S.leads.filter(function (x) { return x.primary.domain === r.domain; })[0]; return !l || inFilter(l); });
    var stopList = stops.length ? h("ul", { class: "list" }, stops.map(function (r) {
      var e = r.event, info = HI.rules.stopEvents[e.event_type];
      var cls = e.event_type === "replied_positive" ? "ok" : (e.event_type === "unsubscribed" || e.event_type === "bounced" ? "bad" : "warn");
      return h("li", null,
        h("div", { class: "main" }, h("b", { text: r.company }),
          h("div", { text: "Day " + e.event_day + " · " + (r.cancelled.length ? "Cancelled " + r.cancelled.join(", ") : "Nothing pending") + (r.postings.length > 1 ? " · covers " + r.postings.join(" + ") : "") })),
        h("span", { class: "pill " + cls, text: info.label }));
    })) : h("div", { class: "empty", text: "No stop events." });

    var dueLeads = S.leads.filter(inFilter).filter(function (l) { return l.eligibility.status === "eligible" && l.followups.steps.some(function (s) { return s.status === "due" || s.status === "scheduled"; }); });
    var paused = S.leads.filter(inFilter).filter(function (l) { return l.followups.steps.some(function (s) { return s.status === "paused"; }); }).length;
    var schedule = h("div", null,
      dueLeads.length ? h("ul", { class: "list" }, dueLeads.map(function (l) {
        var s = l.followups.steps.filter(function (x) { return x.status === "due" || x.status === "scheduled"; })[0];
        return h("li", { style: { cursor: "pointer" }, onclick: function () { openDrawer(l.key); } },
          h("div", { class: "main" }, h("b", { text: l.primary.company }), h("div", { text: (s.step === 1 ? "First email" : "Follow-up (email " + s.step + ")") + " · day " + s.day })),
          h("span", { class: "pill " + (s.status === "due" ? "ok" : ""), text: s.status === "due" ? "Due now" : "Scheduled" }));
      })) : h("div", { class: "empty", text: "Nothing due." }),
      h("div", { class: "note", text: "Schedule: email 1, then email 2 three days later (matches the history). " + (paused ? paused + " lead(s) paused until verified. " : "") + "The suppression check runs right before every send." }));

    return [
      pageHead("Campaign", "How the outreach performed, by variant and overall. Today is day " + S.today + ".", filterBar()),
      h("div", { class: "kpis" },
        kpi(o.sent, "Emails sent"), kpi(o.delivered, "Delivered"), kpi("≈ " + pct(o.open_rate), "Open rate"),
        kpi(o.replied_positive, "Positive replies"), kpi(o.meeting_booked, "Meetings booked"), kpi(o.client_won, "Clients won")),
      h("div", { class: "grid-2" },
        card("Campaign funnel", filtering ? "filtered" : "all leads", funnel),
        card("A/B comparison", null, ab)),
      h("div", { class: "grid-2", style: { marginTop: "16px" } },
        card("Stop rules", "A reply, bounce or unsubscribe stops every pending email to that company", stopList),
        card("Follow-ups", "due now and scheduled", schedule))
    ];
  }

  // ---------- Candidates ----------
  function fitsOf(p) {
    var v = p.fits.filter(function (f) { return f.verified; }).length;
    return { verified: v, partial: p.fits.length - v };
  }
  function viewCandidates() {
    var cf = state.cf;
    var specialties = uniq(S.candidates.map(function (c) { return c.role_specialty; }));
    var rows = S.profiles.filter(function (p) {
      var c = p.candidate;
      return (!cf.specialty || c.role_specialty === cf.specialty) &&
        (!cf.available || c.available_now === cf.available) &&
        (!cf.hours || c.us_hours_available === cf.hours) &&
        (!cf.assigned || (cf.assigned === "yes" ? !!p.assignedTo : !p.assignedTo));
    });
    function sel(key, opts, allLabel) {
      return h("select", { "aria-label": allLabel, onchange: function (e) { cf[key] = e.target.value; render(); } },
        h("option", { value: "", text: allLabel }),
        opts.map(function (o) { return h("option", { value: o[0], selected: cf[key] === o[0] ? true : null, text: o[1] }); }));
    }
    var any = cf.specialty || cf.available || cf.hours || cf.assigned;
    var filters = h("div", { class: "filters" },
      sel("specialty", specialties.map(function (s) { return [s, s]; }), "All specialties"),
      sel("available", [["yes", "Available now"], ["no", "Not available now"]], "Any availability"),
      sel("hours", [["yes", "Can work U.S. hours"], ["no", "No U.S. hours"]], "Any U.S. hours"),
      sel("assigned", [["yes", "Assigned to a company"], ["no", "Not assigned"]], "Any assignment"),
      any ? h("button", { class: "btn ghost small", onclick: function () { state.cf = { specialty: "", available: "", hours: "", assigned: "" }; render(); } }, "Clear") : null);
    var all = S.profiles;
    return [
      pageHead("Candidates", "Synthetic profiles. Each candidate is offered to one company at a time.", filters),
      h("div", { class: "kpis" },
        kpi(all.length, "Candidates"),
        kpi(all.filter(function (p) { return p.candidate.available_now === "yes"; }).length, "Available now"),
        kpi(all.filter(function (p) { return p.assignedTo; }).length, "Assigned to a company"),
        kpi(all.filter(function (p) { return !p.assignedTo && fitsOf(p).verified; }).length, "Verified fit, not assigned")),
      card("All candidates", rows.length + " of " + all.length,
        table([
          { label: "Candidate", get: function (p) { return h("div", { class: "co" }, h("b", { text: p.candidate.candidate_id }), h("div", { text: p.candidate.role_specialty })); } },
          { label: "Skills", cls: "hide-sm", get: function (p) { return h("span", { class: "muted", text: p.candidate.skills_display.join(", ") }); } },
          { label: "Available", get: function (p) { return p.candidate.available_now === "yes" ? h("span", { class: "pill ok", text: "Now" }) : h("span", { class: "pill bad", text: "Not now" }); } },
          { label: "U.S. hours", get: function (p) { return p.candidate.us_hours_available === "yes" ? h("span", { class: "pill ok", text: "Yes" }) : h("span", { class: "pill", text: "No" }); } },
          { label: "Assigned to", get: function (p) { return p.assignedTo ? h("b", { text: p.assignedTo.primary.company }) : h("span", { class: "faint", text: "Not assigned" }); } },
          { label: "Fits", cls: "hide-sm", get: function (p) { var f = fitsOf(p); return h("span", { class: "muted", text: f.verified + " verified · " + f.partial + " partial" }); } }
        ], rows, function (p) { openCandidate(p.candidate.candidate_id); }, "No candidates match these filters."))
    ];
  }
  function openCandidate(id) { state.drawer = null; state.cand = id; renderDrawer(); }
  function renderCandidate(dr) {
    var p = S.profiles.filter(function (x) { return x.candidate.candidate_id === state.cand; })[0];
    if (!p) return false;
    var c = p.candidate, moves = HI.store.decisions().moves;
    var via = { reply: "the company already replied positively", score: "it's the highest-scoring lead this candidate fits", moved: "an employee moved them there" };
    var assigned = p.assignedTo
      ? h("div", { class: "cand" },
          h("div", { class: "top" }, h("b", { text: p.assignedTo.primary.company }), h("span", { class: "pill ok", text: "Assigned" })),
          h("p", { class: "muted", style: { margin: "6px 0 0", fontSize: "13.5px" }, text: p.assignedTo.primary.title + ". Assigned because " + via[p.via] + "." }),
          moves[c.candidate_id] ? h("div", { class: "actions-bar" }, h("button", { class: "btn small", onclick: function () { HI.store.clearMove(c.candidate_id); toast("Move undone"); } }, "Undo move")) : null)
      : h("p", { class: "muted", text: "Not assigned to any company right now." });
    var fits = p.fits.length ? h("ul", { class: "list" }, p.fits.map(function (f) {
      var l = f.lead, canMove = f.verified && l.eligibility.status === "eligible" && !l.assignmentNote && p.assignedTo !== l;
      var total = f.match.matched.length + f.match.missing.length;
      return h("li", null,
        h("div", { class: "main" },
          h("b", { style: { cursor: "pointer" }, onclick: function () { openDrawer(l.key); }, text: l.primary.company }),
          h("div", { text: l.primary.title + " · " + (f.verified ? "verified" : "partial: " + f.match.matched.length + " of " + total + " skills") + (l.score ? " · score " + l.score.total : "") }),
          !f.verified && f.match.gaps.length ? h("div", { class: "faint", text: f.match.gaps.join("; ") }) : null,
          l.assignmentNote && f.verified ? h("div", { class: "faint", text: "Contact stopped, so it doesn't hold a candidate" }) : null),
        h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" } },
          p.assignedTo === l ? h("span", { class: "pill ok", text: "Assigned" }) : status(l),
          canMove ? h("button", { class: "btn small", onclick: function () { HI.store.move(c.candidate_id, l); toast(c.candidate_id + " moved to " + l.primary.company); } }, "Move here") : null));
    })) : h("p", { class: "muted", text: "Doesn't match any lead." });
    clear(dr).appendChild(h("div", { style: { display: "contents" } },
      h("div", { class: "dr-head" },
        h("div", { class: "row" }, h("span", { class: "chip", text: "Synthetic data" }), h("button", { class: "btn ghost small", onclick: closeDrawer, "aria-label": "Close" }, "Close ✕")),
        h("h2", { text: c.candidate_id + " · " + c.role_specialty }),
        h("div", { class: "sub", text: (c.available_now === "yes" ? "Available now" : "Not available now") + " · " + (c.us_hours_available === "yes" ? "can work U.S. hours" : "can't work U.S. hours") })),
      h("div", { class: "dr-body" },
        sec("Skills", null, h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, c.skills_display.map(function (s) { return h("span", { class: "pill", text: s }); }))),
        sec("Assignment", null, assigned),
        sec("Leads this candidate fits", null, fits))));
    return true;
  }

  // ---------- drawer ----------
  function openDrawer(key) {
    var l = leadByKey(key);
    state.drawer = key; state.cand = null;
    state.variant = l && l.drafts.eligible && !l.drafts.A.available ? "B" : "A";
    renderDrawer();
  }
  function closeDrawer() { state.drawer = null; state.cand = null; renderDrawer(); }
  function renderDrawer() {
    var dr = $("drawer"), bd = $("backdrop");
    if (state.cand) { dr.hidden = false; bd.hidden = false; if (renderCandidate(dr)) { dr.focus(); return; } state.cand = null; }
    var l = state.drawer && leadByKey(state.drawer);
    if (!l) { dr.hidden = true; bd.hidden = true; return; }
    dr.hidden = false; bd.hidden = false;
    var p = l.primary, st = l.eligibility.status;

    var actions = null;
    if (st === "needs_check") actions = h("div", { class: "actions-bar" },
      h("button", { class: "btn primary", onclick: function () { HI.store.setCheck(l, "eligible"); toast(p.company + " confirmed eligible"); } }, "Confirm eligible"),
      h("button", { class: "btn", onclick: function () { HI.store.setCheck(l, "ineligible"); toast(p.company + " marked ineligible"); } }, "Mark ineligible"));
    else if (st === "duplicate_check") actions = h("div", { class: "actions-bar" },
      l.postings.map(function (x) { return h("button", { class: "btn", onclick: function () { HI.store.setDuplicate(l, x.posting_id); } }, "Use " + x.posting_id); }),
      h("button", { class: "btn", onclick: function () { HI.store.setDuplicate(l, "ineligible"); } }, "Mark ineligible"));
    else if (l.eligibility.humanDecision || l.resolution === "human_pick" || l.resolution === "human_ineligible") actions = h("div", { class: "actions-bar" },
      h("button", { class: "btn small", onclick: function () {
        if (l.resolution === "human_pick" || l.resolution === "human_ineligible") HI.store.setDuplicate(l, null);
        if (l.eligibility.humanDecision) HI.store.setCheck(l, null);
        toast("Decision undone");
      } }, "Undo employee decision"));

    clear(dr).appendChild(h("div", { style: { display: "contents" } },
      h("div", { class: "dr-head" },
        h("div", { class: "row" }, status(l), h("button", { class: "btn ghost small", onclick: closeDrawer, "aria-label": "Close" }, "Close ✕")),
        h("h2", { text: p.company }),
        h("div", { class: "sub", text: p.title + " · " + p.industry + " · " + l.postingIds.join(" + ") }),
        actions),
      h("div", { class: "dr-body" },
        sectionScore(l), sectionCandidate(l), sectionEmail(l), sectionFollowups(l), sectionEligibility(l))));
    dr.focus();
  }
  function sec(title, right, body) { return h("section", { class: "dr-sec" }, h("h3", null, h("span", { text: title }), right || null), body); }
  function sectionScore(l) {
    var sc = l.score;
    if (!sc) return sec("Priority score", null, h("p", { class: "muted", text: "Not scored: ineligible leads aren't ranked." }));
    var colors = { eligibility: "var(--e)", fit: "var(--f)", urgency: "var(--u)" };
    var names = { eligibility: "Remote eligibility", fit: "Candidate fit", urgency: "Urgency signals" };
    return sec("Priority score", sc.pending ? h("span", { class: "pill warn", text: "Pending verification" }) : null, h("div", null,
      h("div", { class: "total" }, h("b", { text: String(sc.total) }), h("span", { class: "muted", text: "/ 100" })),
      ["eligibility", "fit", "urgency"].map(function (k) {
        var part = sc.parts[k];
        var why = k === "urgency" && part.items.length ? part.items.map(function (i) { return "+" + i.points + " " + i.label; }).join(" · ") : part.reason;
        return h("div", { class: "part" },
          h("span", { class: "name", text: names[k] }), h("span", { class: "pts", text: part.points + " / " + part.max }),
          h("div", { class: "meter" }, h("i", { style: { width: (part.points / part.max * 100) + "%", background: colors[k] } })),
          h("span", { class: "why", text: why }));
      })));
  }
  function evidence(m) {
    return h("ul", { class: "ev" }, m.evidence.map(function (x) { return h("li", { class: "y", text: x }); }), m.gaps.map(function (x) { return h("li", { class: "n", text: x }); }));
  }
  function sectionCandidate(l) {
    var body = [];
    var assigned = l.assignment && l.matches.verified.filter(function (m) { return m.candidate.candidate_id === l.assignment.candidate_id; })[0];
    if (assigned) {
      body.push(h("div", { class: "cand" }, h("div", { class: "top" }, h("b", { text: assigned.candidate.candidate_id + " · " + assigned.candidate.role_specialty }), h("span", { class: "pill ok", text: "Verified · assigned" })), evidence(assigned)));
    } else if (l.assignmentNote && l.matches.verified.length) {
      body.push(h("p", { class: "muted", text: "This contact has stopped, so no candidate is held for it." }));
    } else if (l.blockedBy.length) {
      var b = l.blockedBy[0];
      body.push(h("div", { class: "cand" },
        h("div", { class: "top" }, h("b", { text: b.candidate_id + " fits this role" }), h("span", { class: "pill warn", text: "Assigned elsewhere" })),
        h("p", { class: "muted", style: { margin: "6px 0 10px", fontSize: "13.5px" }, text: "Currently offered to " + b.company + ". One candidate goes to one company at a time." }),
        h("button", { class: "btn small", onclick: function () { HI.store.move(b.candidate_id, l); toast(b.candidate_id + " moved to " + l.primary.company); } }, "Move " + b.candidate_id + " here")));
    } else if (l.matches.verified.length) {
      body.push(h("div", { class: "cand" }, h("div", { class: "top" }, h("b", { text: l.matches.verified[0].candidate.candidate_id + " · " + l.matches.verified[0].candidate.role_specialty }), h("span", { class: "pill", text: "Verified · assigned after verification" })), evidence(l.matches.verified[0])));
    } else if (l.matches.partial.length) {
      var m = l.matches.partial[0];
      body.push(h("div", { class: "cand" }, h("div", { class: "top" }, h("b", { text: m.candidate.candidate_id + " · " + m.candidate.role_specialty }), h("span", { class: "pill warn", text: "Partial: not verified" })), evidence(m)));
    } else body.push(h("p", { class: "muted", text: "No candidate has any of the required skills." }));
    return sec("Candidate", h("span", { class: "chip", text: "Synthetic data" }), body);
  }
  function sectionEmail(l) {
    var d = l.drafts;
    if (!d.eligible) return sec("First email", null, h("div", { class: "unavail", text: d.reason }));
    var x = d[state.variant];
    var seg = h("div", { class: "seg" }, ["A", "B"].map(function (v) {
      return h("button", { class: state.variant === v ? "on" : null, onclick: function () { state.variant = v; renderDrawer(); } }, v === "A" ? "A · candidate" : "B · process");
    }));
    var body = x.available
      ? h("div", null, h("div", { class: "mail" }, h("div", { class: "subj", text: x.subject }), h("div", { class: "body", text: x.body })),
          h("div", { class: "mail-meta", text: x.words + " words · draft only, nothing is sent" + (l.followups.variant ? " · in the campaign as variant " + l.followups.variant : "") }))
      : h("div", { class: "unavail", text: "Variant A isn't available. " + x.reason });
    return sec("First email", seg, body);
  }
  function sectionFollowups(l) {
    var fu = l.followups;
    var label = { sent: "Sent", due: "Due now", scheduled: "Scheduled", paused: "Paused", cancelled: "Cancelled" };
    var cls = { sent: "", due: "ok", scheduled: "", paused: "warn", cancelled: "bad" };
    var list = fu.steps.length ? h("ul", { class: "timeline" }, fu.steps.map(function (s) {
      return h("li", null, h("span", { class: "d", text: "Day " + s.day }),
        h("span", null, h("b", { text: "Email " + s.step + " " }), h("span", { class: "pill " + cls[s.status], text: label[s.status] }),
          s.flags && s.flags.length ? h("div", { class: "faint", style: { fontSize: "12.5px", marginTop: "2px" }, text: "⚠ " + s.flags.join("; ") }) : null));
    })) : h("p", { class: "muted", text: "No emails planned." });
    var c = fu.check;
    return sec("Follow-ups", null, h("div", null, list,
      h("div", { class: "check-line " + (c.ok ? "ok" : c.kind === "paused" ? "paused" : "stop"), text: (c.ok ? "✓ " : "✕ ") + c.reason })));
  }
  function sectionEligibility(l) {
    return sec("Eligibility", null, h("div", null,
      h("ul", { class: "ev" }, l.eligibility.reasons.map(function (r) { return h("li", { class: l.eligibility.status === "ineligible" ? "n" : "y", text: r }); })),
      h("p", { class: "muted", style: { fontSize: "13px", marginTop: "8px" }, text: "Remote policy " + l.primary.remote_policy + " · U.S. hours " + l.primary.us_hours_required + " · Skills: " + l.primary.required_skills_display.join(", ") +
        (l.isDuplicate ? " · Repeat postings " + l.postingIds.join(" + ") + " (" + l.primary.posting_id + " used)" : "") })));
  }

  // ---------- data menu + notes ----------
  function showNotes() {
    var m = $("modal"), areas = uniq(S.notes.map(function (n) { return n.area; }));
    clear(m).appendChild(h("div", null,
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("h2", { text: "Data notes" }), h("button", { class: "btn ghost small", onclick: closeModal }, "Close ✕")),
      h("p", { class: "muted", text: "Things worth knowing about the data. Nothing here is changed automatically." }),
      h("h3", { text: "Loaded files" }),
      h("ul", null, ["jobs", "candidates", "events"].map(function (k) { return h("li", { text: k + ": " + S.sources[k] + " (built in)" }); })),
      areas.map(function (a) { return [h("h3", { text: a }), h("ul", null, S.notes.filter(function (n) { return n.area === a; }).map(function (n) { return h("li", { text: n.text }); }))]; })));
    m.hidden = false; $("backdrop").hidden = false;
  }
  function closeModal() { $("modal").hidden = true; if (!state.drawer && !state.cand) $("backdrop").hidden = true; }
  var toastTimer = null;
  function toast(text, error) {
    var t = $("toast"); t.textContent = text; t.className = "toast" + (error ? " error" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, error ? 6000 : 2600);
  }

  // ---------- render ----------
  function render() {
    S = HI.store.snapshot();
    var waiting = S.counts.needs_check + S.counts.duplicate_check;
    var tabs = clear($("tabs"));
    [["opportunities", "Opportunities", null], ["leads", "Leads", waiting], ["candidates", "Candidates", null], ["campaign", "Campaign", null]].forEach(function (t) {
      tabs.appendChild(h("button", { class: state.tab === t[0] ? "on" : null, "aria-current": state.tab === t[0] ? "page" : null, onclick: function () { state.tab = t[0]; render(); window.scrollTo(0, 0); } },
        t[1], t[2] ? h("span", { class: "count warn", title: "Needs verification", text: String(t[2]) }) : null));
    });
    $("notes-count").textContent = String(S.notes.length);
    var main = clear($("main"));
    var view = { opportunities: viewOpportunities, leads: viewLeads, candidates: viewCandidates, campaign: viewCampaign }[state.tab]();
    [].concat(view).forEach(function (n) { if (n) main.appendChild(n); });
    if (state.drawer || state.cand) renderDrawer();
  }

  // ---------- sign-in (demo gate) ----------
  // This runs entirely in the browser, so it is NOT real security: anyone can read these values in the file.
  // It only shows where a real login would sit. Production: server-side accounts, hashed passwords, sessions.
  var DEMO_USER = "admin", DEMO_PASS = "admin", SESSION_KEY = "hireintercept-product-session";
  var started = false;

  function signedIn() { try { return window.sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  function showApp(user) {
    $("auth").hidden = true; $("app").hidden = false;
    $("who").textContent = "(" + user + ")";
    if (!started) { started = true; startApp(); }
  }
  function showAuth() {
    $("app").hidden = true; $("auth").hidden = false;
    state.drawer = null; state.cand = null; renderDrawer(); closeModal();
    switchAuth("login");
    $("login-pass").value = DEMO_PASS; $("login-user").value = DEMO_USER;
    $("login-user").focus();
  }
  function switchAuth(which) {
    var login = which === "login";
    $("login-form").hidden = !login; $("register-form").hidden = login;
    $("tab-login").className = login ? "on" : ""; $("tab-register").className = login ? "" : "on";
    $("tab-login").setAttribute("aria-selected", String(login)); $("tab-register").setAttribute("aria-selected", String(!login));
    $("login-msg").hidden = true; $("reg-msg").hidden = true;
  }
  function msg(id, text, info) { var m = $(id); m.textContent = text; m.className = "auth-msg" + (info ? " info" : ""); m.hidden = false; }

  function startAuth() {
    $("tab-login").addEventListener("click", function () { switchAuth("login"); });
    $("tab-register").addEventListener("click", function () { switchAuth("register"); });
    $("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var u = $("login-user").value.trim(), p = $("login-pass").value;
      if (!u || !p) { msg("login-msg", "Enter a username and password."); return; }
      if (u !== DEMO_USER || p !== DEMO_PASS) { msg("login-msg", "Incorrect username or password."); $("login-pass").value = ""; $("login-pass").focus(); return; }
      try { window.sessionStorage.setItem(SESSION_KEY, u); } catch (err) { /* storage blocked: stays signed in until the page is closed */ }
      showApp(u);
    });
    $("register-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("reg-name").value.trim(), email = $("reg-email").value.trim(), user = $("reg-user").value.trim();
      var p1 = $("reg-pass").value, p2 = $("reg-pass2").value;
      if (!name || !email || !user || !p1 || !p2) { msg("reg-msg", "Please fill in every field."); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("reg-msg", "Enter a valid email address."); return; }
      if (p1.length < 8) { msg("reg-msg", "Use at least 8 characters for the password."); return; }
      if (p1 !== p2) { msg("reg-msg", "The passwords don't match."); return; }
      msg("reg-msg", "Thanks, " + name + ". Registration isn't switched on in this prototype, so no account was created. Use the demo account to log in.", true);
      $("reg-pass").value = ""; $("reg-pass2").value = "";
    });
    $("m-logout").addEventListener("click", function () {
      $("data-menu").hidden = true;
      try { window.sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
      showAuth();
    });
    var user = signedIn();
    if (user) showApp(user); else showAuth();
  }

  function startApp() {
    var menu = $("data-menu");
    $("data-btn").addEventListener("click", function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    $("m-notes").addEventListener("click", function () { menu.hidden = true; showNotes(); });
    $("m-reset").addEventListener("click", function () { menu.hidden = true; if (window.confirm("Undo all employee decisions and candidate moves?")) { HI.store.resetDecisions(); toast("Decisions reset"); } });
    $("backdrop").addEventListener("click", function () { if (!$("modal").hidden) closeModal(); else closeDrawer(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { if (!$("modal").hidden) closeModal(); else if (state.drawer || state.cand) closeDrawer(); } });
    HI.store.onChange(render);
    try { HI.store.init(); }
    catch (e) { clear($("main")).appendChild(h("div", { class: "empty", text: "The data couldn't be processed: " + e.message })); }
  }
  document.addEventListener("DOMContentLoaded", startAuth);
})(this.HI = this.HI || {});
