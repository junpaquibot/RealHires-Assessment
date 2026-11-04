/*
 * eligibility.js: decides whether a lead can be filled from overseas (R1).
 *   ineligible:      U.S. only, on-site, or a local licence is required. A person can't override this.
 *   needs_check:     eligibility is unclear, so a person must confirm before any outreach.
 *   duplicate_check: linked postings disagree, so a person must pick the record.
 *   eligible:        clear GLOBAL, or confirmed by a person.
 */
(function (HI) {
  "use strict";

  function has(text, words) {
    var t = String(text || "").toLowerCase();
    return words.filter(function (w) { return t.indexOf(w) >= 0; })[0] || null;
  }

  function licenceReason(job) {
    var hay = [job.title].concat(job.required_skills).join(" | ");
    var hit = has(hay, HI.rules.licenceKeywords);
    return hit ? "Local licence required (\"" + hit + "\" in title/skills). The candidate data has no licence field, so no candidate can be matched" : null;
  }

  function evaluate(lead, decisions) {
    var R = HI.rules, job = lead.primary, hard = [], soft = [];
    var human = decisions && decisions.checks ? decisions.checks[lead.key] : null;

    if (R.ineligiblePolicies[job.remote_policy]) hard.push(R.ineligiblePolicies[job.remote_policy]);
    var lic = licenceReason(job);
    if (lic) hard.push(lic);

    if (R.verifyPolicies[job.remote_policy]) soft.push(R.verifyPolicies[job.remote_policy]);
    if (R.remotePolicies.indexOf(job.remote_policy) < 0) soft.push("Remote policy \"" + job.remote_policy + "\" not recognised");
    if (job.remote_policy === "GLOBAL") {
      var note = has(job.notes, R.verifyNoteKeywords);
      if (note) soft.push("Listed as GLOBAL, but the note says \"" + job.notes + "\"");
    }

    var res = { status: "eligible", reasons: [], humanDecision: null, licence: !!lic };

    if (lead.resolution === "human_ineligible") {
      res.status = "ineligible"; res.reasons = ["Duplicate postings conflict: marked ineligible by a reviewer"]; res.humanDecision = "ineligible";
      return res;
    }
    if (lead.resolution === "needs_check") {
      res.status = "duplicate_check";
      res.reasons = lead.conflicts.map(function (c) {
        return "Linked postings disagree on " + c.label.toLowerCase() + ": " +
          c.values.map(function (v) { return v.posting_id + " = " + (v.value || "(blank)"); }).join(", ");
      });
      return res;
    }
    if (hard.length) { res.status = "ineligible"; res.reasons = hard; return res; }
    if (soft.length) {
      if (human === "eligible") { res.status = "eligible"; res.reasons = ["Confirmed eligible by a reviewer (was: " + soft.join("; ") + ")"]; res.humanDecision = "eligible"; }
      else if (human === "ineligible") { res.status = "ineligible"; res.reasons = ["Marked ineligible by a reviewer (" + soft.join("; ") + ")"]; res.humanDecision = "ineligible"; }
      else { res.status = "needs_check"; res.reasons = soft; }
      return res;
    }
    res.reasons = [lead.resolution === "human_pick" ? "Clear GLOBAL remote policy (record picked by a reviewer)" : "Clear GLOBAL remote policy"];
    return res;
  }

  HI.eligibility = { evaluate: evaluate };
})(this.HI = this.HI || {});
