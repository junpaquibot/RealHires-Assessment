/*
 * outreach.js: two short, truthful first-contact drafts per eligible lead (R4).
 *   A, candidate-first: only when a verified candidate is assigned to this lead. It never invents one.
 *   B, process-first:   always available. It makes no claims we can't back. Unknown facts are left as [placeholders].
 * Nothing is sent. Drafts go to a simulated outbox only (production: Apollo sequences, after the stop check).
 */
(function (HI) {
  "use strict";

  function words(t) { return t.split(/\s+/).filter(Boolean).length; }

  function article(word) { return /^[aeiou]/i.test(word) ? "an " + word : "a " + word; }

  function list(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  function variantA(lead, candidatesById) {
    var D = HI.rules.draft, job = lead.primary;
    if (!lead.assignment) {
      var why = lead.assignmentNote && lead.matches.verified.length
        ? "This contact has stopped, so no candidate is held for it (" + lead.assignmentNote.replace(/^.*\((.*)\)$/, "$1") + "). Use B only if the contact is re-opened."
        : lead.matches.verified.length
        ? "The verified candidate (" + lead.blockedBy.map(function (b) { return b.candidate_id + " → " + b.company; }).join(", ") + ") is assigned to another lead. Use B, or move the candidate."
        : "No verified candidate for this role. A won't invent one, so use B.";
      return { available: false, reason: why };
    }
    var m = lead.matches.verified.filter(function (v) { return v.candidate.candidate_id === lead.assignment.candidate_id; })[0];
    var c = m.candidate;
    var hoursLine = c.us_hours_available === "yes" ? " and can work U.S. business hours" : "";
    var subject = job.title + ": a candidate who matches your listing";
    var body =
      "Hi " + job.company + " hiring team,\n\n" +
      "I saw you're hiring " + article(job.title) + ". Real Hires has a remote candidate in our talent pool (ref " + c.candidate_id +
      ") whose listed skills cover everything in your posting: " + list(m.matched) + ". They're available to start now" + hoursLine + ".\n\n" +
      "Would " + D.ask + " this week be useful to see if they fit?\n\n" +
      D.signOff + "\n\n" + D.optOut;
    return { available: true, subject: subject, body: body, words: words(body), candidate_id: c.candidate_id,
      claims: ["Skills: " + list(m.matched) + " (from candidate skills)", "available_now = yes", c.us_hours_available === "yes" ? "us_hours_available = yes" : "U.S. hours not mentioned (candidate can't)"] };
  }

  function variantB(lead) {
    var D = HI.rules.draft, job = lead.primary;
    var subject = "Filling your " + job.title + " role faster";
    var body =
      "Hi " + job.company + " hiring team,\n\n" +
      "I saw you're hiring " + article(job.title) + ". Real Hires helps U.S. teams hire pre-screened international remote staff. " +
      "We screen for the skills you list (" + list(job.required_skills_display) + ") before you see anyone, so your team only interviews people who fit. " +
      "We can usually share a shortlist within [X business days: confirm before sending].\n\n" +
      "Would " + D.ask + " to walk through how it works be useful?\n\n" +
      D.signOff + "\n\n" + D.optOut;
    return { available: true, subject: subject, body: body, words: words(body),
      claims: ["Required skills copied from the job listing", "Turnaround left as a placeholder: no unverified speed claim"] };
  }

  function drafts(lead, candidatesById) {
    if (lead.eligibility.status !== "eligible") {
      return { eligible: false, reason: lead.eligibility.status === "ineligible" ? "No drafts: lead is ineligible." : "Drafts become available after a person confirms eligibility." };
    }
    var a = variantA(lead, candidatesById), b = variantB(lead);
    [a, b].forEach(function (d) { if (d.available && d.words > HI.rules.draft.maxWords) d.warning = "Over " + HI.rules.draft.maxWords + " words"; });
    return { eligible: true, A: a, B: b };
  }

  HI.outreach = { drafts: drafts };
})(this.HI = this.HI || {});
