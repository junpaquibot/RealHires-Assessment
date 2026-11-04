/*
 * matching.js: compares a job's required skills with each candidate (R3).
 *   verified: every required skill, available now, and U.S. hours if the job requires them.
 *   partial:  at least one skill matches, but something is missing. The gaps are always listed.
 * Wording rules: a candidate is never called available unless available_now = yes, and never
 * said to work U.S. hours unless us_hours_available = yes.
 */
(function (HI) {
  "use strict";

  function evaluate(job, cand, licenceRequired) {
    var req = job.required_skills;
    var matched = req.filter(function (s) { return cand.skills.indexOf(s) >= 0; });
    var missing = req.filter(function (s) { return cand.skills.indexOf(s) < 0; });
    var display = function (keys) {
      return keys.map(function (k) { return job.required_skills_display[req.indexOf(k)] || k; });
    };
    var available = cand.available_now === "yes";
    var hours;
    if (job.us_hours_required === "yes") hours = cand.us_hours_available === "yes" ? "ok" : "gap";
    else if (job.us_hours_required === "unknown") hours = cand.us_hours_available === "yes" ? "ok_if_needed" : "to_confirm";
    else hours = "not_required";

    var evidence = [], gaps = [];
    if (matched.length) evidence.push("Has " + matched.length + " of " + req.length + " required skills: " + display(matched).join(", "));
    if (missing.length) gaps.push("Missing skill" + (missing.length > 1 ? "s" : "") + ": " + display(missing).join(", "));
    if (available) evidence.push("available_now = yes");
    else gaps.push("Not available now (available_now = " + cand.available_now + ")");
    if (hours === "ok") evidence.push("Job requires U.S. hours; us_hours_available = yes");
    if (hours === "ok_if_needed") evidence.push("Job's U.S. hours are unknown; candidate can work them if needed");
    if (hours === "gap") gaps.push("Job requires U.S. hours; candidate can't (us_hours_available = " + cand.us_hours_available + ")");
    if (hours === "to_confirm") gaps.push("Job's U.S. hours are unknown and the candidate can't work them: confirm with the employer");
    if (licenceRequired) gaps.push("Job needs a local licence; candidate licence status is unknown");

    var verified = req.length > 0 && missing.length === 0 && available && hours !== "gap" && !licenceRequired;
    return {
      candidate: cand,
      matched: display(matched),
      missing: display(missing),
      share: req.length ? matched.length / req.length : 0,
      available: available,
      hours: hours,
      verified: verified,
      evidence: evidence,
      gaps: gaps
    };
  }

  function forLead(lead, candidates) {
    var job = lead.primary;
    var all = candidates.map(function (c) { return evaluate(job, c, lead.eligibility && lead.eligibility.licence); });
    var verified = all.filter(function (m) { return m.verified; });
    var partial = all.filter(function (m) {
      return !m.verified && m.matched.length >= HI.rules.matching.partialMinSkills;
    }).sort(function (a, b) {
      return b.share - a.share || (b.available - a.available) || a.candidate.candidate_id.localeCompare(b.candidate.candidate_id);
    });
    return { verified: verified, partial: partial.slice(0, HI.rules.matching.maxPartialsShown), partialTotal: partial.length };
  }

  HI.matching = { forLead: forLead, evaluate: evaluate };
})(this.HI = this.HI || {});
