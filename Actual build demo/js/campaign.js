/*
 * campaign.js: links events.csv history to leads, finds stop events per contact, and flags any
 * history that broke our rules (R5.2). History is never rewritten. It's reported as recorded, with a ⚠.
 * Contact = company domain (R5.1: there's no contact column in the data).
 */
(function (HI) {
  "use strict";

  function before(a, b) { return a.event_day < b.event_day || (a.event_day === b.event_day && a.order < b.order); }

  function attach(events, leads) {
    var byPosting = {};
    leads.forEach(function (l) { l.history = []; l.postingIds.forEach(function (id) { byPosting[id] = l; }); });
    var orphans = [];
    events.forEach(function (e) {
      var lead = byPosting[e.posting_id];
      if (!lead) { e.flags.push("Event for a posting that isn't in the jobs file"); orphans.push(e); return; }
      e.leadKey = lead.key;
      e.domain = lead.primary.domain;
      lead.history.push(e);
    });
    leads.forEach(function (l) { l.history.sort(function (a, b) { return before(a, b) ? -1 : 1; }); });
    return orphans;
  }

  // Stop events grouped by contact (domain). One stop applies to every lead and posting at that domain (R6.2).
  function stopsByDomain(events) {
    var out = {};
    events.forEach(function (e) {
      if (e.ignored || !e.domain || !HI.rules.stopEvents[e.event_type]) return;
      (out[e.domain] = out[e.domain] || []).push(e);
    });
    Object.keys(out).forEach(function (d) { out[d].sort(function (a, b) { return before(a, b) ? -1 : 1; }); });
    return out;
  }

  function flagSends(leads, stops) {
    leads.forEach(function (lead) {
      var base = lead.eligibility.baseStatus;
      lead.history.forEach(function (e) {
        if (e.event_type !== "sent" || e.simulated) return;
        if (base === "ineligible") e.flags.push("Sent to an ineligible lead (" + lead.eligibility.baseReasons[0] + ")");
        if (base === "needs_check" || base === "duplicate_check") e.flags.push("Sent before eligibility was verified");
        if (e.variant === "A" && !lead.matches.verified.length) e.flags.push("Variant A sent, but there's no verified candidate for this role");
        var prior = (stops[lead.primary.domain] || []).filter(function (s) { return !s.simulated && before(s, e); })[0];
        if (prior) e.flags.push("Sent after a stop event (" + prior.event_id + " " + prior.event_type + " on day " + prior.event_day + ")");
      });
    });
  }

  // Message = one posting + step. Every event about a flagged send counts toward that metric's "⚠ flagged" figure.
  function messageKey(e) { return e.posting_id + "|" + e.step; }

  HI.campaign = { attach: attach, stopsByDomain: stopsByDomain, flagSends: flagSends, messageKey: messageKey, before: before };
})(this.HI = this.HI || {});
