/*
 * explainer.js: fills the guide (explainer.html) with live numbers from the same pipeline as the simulator,
 * and builds the step-by-step section from js/components.js. The prose itself lives in explainer.html.
 */
(function (HI) {
  "use strict";
  var h = HI.ui.h, clear = HI.ui.clear;
  var TYPE_COLOR = { in: "var(--in)", step: "var(--step)", gate: "var(--gate)", dash: "var(--dash)", emp: "var(--emp)" };

  function lead(S, id) { return S.leads.filter(function (l) { return l.postingIds.indexOf(id) >= 0; })[0]; }

  // One short live line per component: real numbers from the current data.
  var LIVE = {
    jobs: function (S) { return [S.jobs.length + " postings loaded", S.importIssues.length + " import issues"]; },
    candidates: function (S) { return [S.candidates.length + " candidates", S.candidates.filter(function (c) { return c.available_now === "yes"; }).length + " available now"]; },
    events: function (S) { var n = S.events.filter(function (e) { return !e.simulated; }).length; return [n + " events", S.counts.flaggedSends + " sends flagged ⚠"]; },
    normalize: function (S) { var j = S.jobs[0]; return j ? ["\"" + j.required_skills_display.join(";") + "\" → " + j.required_skills.length + " skills"] : []; },
    dedup: function (S) { var hb = lead(S, "JOB-030"); return [S.jobs.length + " postings → " + S.leads.length + " leads", S.counts.duplicateGroups + " duplicate groups", hb ? "Harborwell: " + (hb.resolution === "needs_check" ? "waiting for an employee" : hb.resolution) : null]; },
    eligibility: function (S) { var c = S.counts; return [c.eligible + " eligible", (c.needs_check + c.duplicate_check) + " need verification", c.ineligible + " ineligible"]; },
    matching: function (S) { var g = lead(S, "JOB-014"); return [S.profiles.filter(function (p) { return p.assignedTo; }).length + " candidates assigned", g && g.assignment ? "Goldleaf → " + g.assignment.candidate_id + " (verified)" : null]; },
    scoring: function (S) { var t = S.ranked[0]; return t ? ["Top: " + t.primary.company + " " + t.score.total + " = " + t.score.parts.eligibility.points + " + " + t.score.parts.fit.points + " + " + t.score.parts.urgency.points, S.ranked.length + " scored"] : []; },
    outreach: function (S) { var el = S.leads.filter(function (l) { return l.drafts.eligible; }); return [el.length + " leads with drafts", el.filter(function (l) { return l.drafts.A.available; }).length + " have variant A", "0 sent"]; },
    suppression: function (S) { var r = S.leads.filter(function (l) { return l.followups.steps.length; }); return [r.filter(function (l) { return l.followups.check.ok; }).length + " clear to send", r.filter(function (l) { return !l.followups.check.ok && l.followups.check.kind === "cancelled"; }).length + " stopped", r.filter(function (l) { return l.followups.check.kind === "paused"; }).length + " paused"]; },
    tracking: function (S) { var o = S.funnel.values.overall; return [o.sent + " sent", o.unique_opens + " unique opens (from " + o.raw_opens + ")", "open rate ≈ " + Math.round(o.open_rate * 100) + "%", o.client_won + " client won"]; },
    stops: function (S) { var due = S.leads.filter(function (l) { return l.eligibility.status === "eligible" && l.followups.steps.some(function (s) { return s.status === "due"; }); }).length; var hb = lead(S, "JOB-030"); return [S.stopLog.length + " stop events", due + " leads with an email due now", hb && hb.followups.check.stop ? "JOB-004's unsubscribe also stops JOB-030 ✓" : null]; },
    dashboard: function (S) { return [S.ranked.length + " ranked opportunities", S.notes.length + " data notes"]; },
    employee: function (S) { return [(S.counts.needs_check + S.counts.duplicate_check) + " leads waiting for a decision", HI.store.decisions().audit.length + " actions logged"]; }
  };

  function renderStages(S) {
    var box = clear(document.getElementById("stages-list"));
    HI.components.GROUPS.forEach(function (g) {
      box.appendChild(h("h3", { text: g.label }));
      HI.components.list.filter(function (c) { return c.group === g.id; }).forEach(function (c) {
        var bits = (LIVE[c.id] ? LIVE[c.id](S) : []).filter(Boolean);
        box.appendChild(h("div", { class: "stage" },
          h("div", { class: "stage-head" }, h("h3", null, h("i", { style: { background: TYPE_COLOR[c.type] } }), c.title),
            h("a", { href: "simulator.html#" + c.id }, "See it running →")),
          h("p", { text: c.what }),
          h("div", { class: "live" }, h("span", { class: "tag", text: "Live" }), bits.map(function (b) { return h("span", { text: b }); }),
            h("span", { class: "faint", text: "· code: " + c.file }))));
      });
    });
  }

  function renderMoves() {
    var box = clear(document.getElementById("moves"));
    box.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, h("th", { text: "Component" }), h("th", { text: "In the prototype" }), h("th", { text: "In production (recommended)" }))),
      h("tbody", null, HI.components.list.map(function (c) {
        var pick = c.deploy.filter(function (o) { return o.pick; })[0];
        return h("tr", null, h("td", null, h("b", { text: c.title })), h("td", null, h("code", { text: c.file })),
          h("td", null, h("div", { text: pick ? pick.name : "" }), h("div", { class: "faint", style: { fontSize: "12.5px" }, text: c.prod })));
      })))));
  }

  function fillNumbers(S) {
    var o = S.funnel.values.overall;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = String(v); };
    set("n-postings", S.counts.postings); set("n-leads", S.counts.leads); set("n-eligible", S.counts.eligible);
    set("n-waiting", S.counts.needs_check + S.counts.duplicate_check); set("n-sent", o.sent); set("n-flagged", S.counts.flaggedSends);
  }

  function scrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
    var secs = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    function onScroll() {
      var y = window.scrollY + 120, cur = 0;
      secs.forEach(function (s, i) { if (s && s.offsetTop <= y) cur = i; });
      links.forEach(function (a, i) { a.className = i === cur ? "on" : ""; });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  document.addEventListener("DOMContentLoaded", function () {
    HI.store.onChange(function (S) { fillNumbers(S); renderStages(S); });
    try { HI.store.init(); } catch (e) { document.getElementById("stages-list").textContent = "The data couldn't be processed: " + e.message; }
    renderMoves();
    scrollSpy();
  });
})(this.HI = this.HI || {});
