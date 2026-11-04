/*
 * scoring.js: an explainable 0–100 priority score (R2). Every point comes with a reason.
 *   Remote eligibility (30): clear = 30, waiting for a person = 10 and labelled "pending".
 *   Candidate fit (40):      verified match = 40; best partial = 30 × share of skills matched; none = 0.
 *   Urgency (30):            "urgent" note +10, freshness +10/+5, repeat posting +10.
 * Ineligible leads are not scored. Salary, company size and notes are context only (R2.5).
 */
(function (HI) {
  "use strict";

  function contains(text, words) {
    var t = String(text || "").toLowerCase();
    return words.some(function (w) { return t.indexOf(w) >= 0; });
  }

  function score(lead) {
    var R = HI.rules, st = lead.eligibility.status;
    if (st === "ineligible") return null;
    var pending = st !== "eligible";

    var elig = pending
      ? { points: R.eligibilityPoints.pending, max: R.weights.eligibility, reason: st === "duplicate_check" ? "Pending: duplicate postings disagree" : "Pending: eligibility needs a human check" }
      : { points: R.eligibilityPoints.eligible, max: R.weights.eligibility, reason: lead.eligibility.humanDecision ? "Eligible: confirmed by a reviewer" : "Eligible: clear GLOBAL remote policy" };

    var m = lead.matches, fit;
    if (m.verified.length) {
      fit = { points: R.fitPoints.verified, max: R.weights.fit, reason: "Verified match: " + m.verified.map(function (v) { return v.candidate.candidate_id; }).join(", ") };
    } else if (m.partial.length) {
      var best = m.partial[0];
      var pts = Math.round(R.fitPoints.partialMax * best.share);
      fit = { points: pts, max: R.weights.fit, reason: "Partial only: " + best.candidate.candidate_id + " has " + best.matched.length + " of " + (best.matched.length + best.missing.length) + " skills" + (best.gaps.length ? " (" + best.gaps.join("; ") + ")" : "") };
    } else {
      fit = { points: 0, max: R.weights.fit, reason: "No candidate has any of the required skills" };
    }

    var U = R.urgency, items = [], job = lead.primary;
    // Signals come from the primary record only (R1.2: no field-by-field merge).
    if (contains(job.notes, U.urgentNoteKeywords)) {
      items.push({ points: U.urgentPoints, label: "Note says \"" + job.notes + "\"" });
    }
    var days = job.posted_days_ago;
    if (days != null) {
      var tier = U.freshness.filter(function (t) { return days <= t.maxDays; })[0];
      if (tier) items.push({ points: tier.points, label: "Posted " + days + " day" + (days === 1 ? "" : "s") + " ago (≤ " + tier.maxDays + " days)" });
    }
    var repeatWhy = [];
    if (lead.isDuplicate) repeatWhy.push("linked to " + (lead.postings.length - 1) + " other posting" + (lead.postings.length > 2 ? "s" : ""));
    if (job.repost_count > 0) repeatWhy.push("repost_count = " + job.repost_count);
    if (contains(job.notes, U.repeatNoteKeywords)) repeatWhy.push("note says \"" + job.notes + "\"");
    if (repeatWhy.length) items.push({ points: U.repeatPoints, label: "Repeat posting (" + repeatWhy.join(", ") + "): " + U.repeatWording });
    var urgPts = Math.min(R.weights.urgency, items.reduce(function (s, i) { return s + i.points; }, 0));
    var urgency = { points: urgPts, max: R.weights.urgency, items: items, reason: items.length ? items.map(function (i) { return "+" + i.points + " " + i.label; }).join(" · ") : "No urgency signals" };

    return {
      total: elig.points + fit.points + urgency.points,
      pending: pending,
      parts: { eligibility: elig, fit: fit, urgency: urgency }
    };
  }

  HI.scoring = { score: score };
})(this.HI = this.HI || {});
