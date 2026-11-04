/*
 * pipeline.js: the orchestrator. One function, run(), takes raw CSV text plus human decisions and
 * returns a complete snapshot. Both views (index.html and explainer.html) call this same function,
 * so their numbers always match. It's pure: no DOM, no storage, no network.
 *
 * decisions = {
 *   checks:     { leadKey: "eligible" | "ineligible" },   // Needs human check queue (R1.3)
 *   duplicates: { leadKey: posting_id | "ineligible" },   // Duplicate check (R1.2)
 *   moves:      { candidate_id: leadKey },                 // recruiter reassignment (R3.3)
 *   simEvents:  [ { posting_id, event_type, event_day } ]  // what-if events (R6 demo); never counted in metrics
 * }
 */
(function (HI) {
  "use strict";

  function run(texts, decisions) {
    decisions = decisions || {};
    var issues = [];

    // 1. Retrieval + parse (with header checks)
    var parsed = {};
    ["jobs", "candidates", "events"].forEach(function (k) { parsed[k] = HI.sources.parseKind(k, texts[k].text); });

    // 2. Normalize
    var nj = HI.normalize.jobs(parsed.jobs.records);
    var nc = HI.normalize.candidates(parsed.candidates.records);
    var ne = HI.normalize.events(parsed.events.records);
    issues = issues.concat(nj.issues, nc.issues, ne.issues);
    var jobs = nj.items, candidates = nc.items, events = ne.items;

    // Simulated events (what-ifs) are appended and clearly marked. They affect stop rules, never the history metrics.
    (decisions.simEvents || []).forEach(function (s, i) {
      events.push({ event_id: "SIM-" + (i + 1), posting_id: s.posting_id, variant: s.variant || "", step: s.step || 1,
        event_type: s.event_type, event_day: s.event_day, order: 100000 + i, flags: [], simulated: true });
    });

    // 3. Deduplicate into leads
    var leads = HI.dedup.group(jobs, decisions);
    var baseLeads = HI.dedup.group(jobs, {}); // no human input, for "what the rules said at the time"
    var baseByKey = {};
    baseLeads.forEach(function (b) { baseByKey[b.key] = b; });

    // 4. Eligibility
    leads.forEach(function (l) {
      l.eligibility = HI.eligibility.evaluate(l, decisions);
      var base = HI.eligibility.evaluate(baseByKey[l.key], {});
      l.eligibility.baseStatus = base.status;
      l.eligibility.baseReasons = base.reasons;
    });

    // 5. Matching + 6. Scoring
    leads.forEach(function (l) {
      l.matches = HI.matching.forLead(l, candidates);
      l.score = HI.scoring.score(l);
    });

    // 7. Events: link to leads, find stops per contact, flag rule-breaking history
    var orphans = HI.campaign.attach(events, leads);
    var stops = HI.campaign.stopsByDomain(events);
    HI.campaign.flagSends(leads, stops);
    var histDays = events.filter(function (e) { return !e.simulated; }).map(function (e) { return e.event_day; });
    var today = HI.rules.today != null ? HI.rules.today : (histDays.length ? Math.max.apply(null, histDays) : 0);

    // 8. Candidate assignment (one lead per candidate)
    var assigned = HI.assignment.run(leads, stops, decisions);

    // 9. Follow-ups + stop checks, 10. Drafts
    var candById = {};
    candidates.forEach(function (c) { candById[c.candidate_id] = c; });
    leads.forEach(function (l) {
      l.followups = HI.followups.schedule(l, stops, today);
      l.drafts = HI.outreach.drafts(l, candById);
      l.outcome = outcomeOf(l);
    });

    // Candidate profiles: every lead they fit, ranked by score
    var profiles = candidates.map(function (c) {
      var fits = [];
      leads.forEach(function (l) {
        var v = l.matches.verified.filter(function (m) { return m.candidate === c; })[0];
        var p = !v && l.matches.partial.filter(function (m) { return m.candidate === c; })[0];
        if (v || p) fits.push({ lead: l, match: v || p, verified: !!v });
      });
      fits.sort(function (a, b) { return (b.verified - a.verified) || ((b.lead.score ? b.lead.score.total : -1) - (a.lead.score ? a.lead.score.total : -1)); });
      var a = assigned[c.candidate_id] || null;
      return { candidate: c, fits: fits, assignedTo: a ? leads.filter(function (l) { return l.key === a.leadKey; })[0] : null, via: a ? a.via : null };
    });

    var snapshot = {
      today: today, jobs: jobs, candidates: candidates, events: events, leads: leads, stops: stops,
      orphans: orphans, importIssues: issues, profiles: profiles,
      sources: { jobs: texts.jobs.name, candidates: texts.candidates.name, events: texts.events.name },
      origin: { jobs: texts.jobs.origin, candidates: texts.candidates.origin, events: texts.events.origin }
    };
    snapshot.stopLog = HI.followups.stopLog(leads, stops);
    snapshot.ranked = leads.filter(function (l) { return l.score; }).sort(function (a, b) {
      return (a.score.pending - b.score.pending) || (b.score.total - a.score.total) ||
        ((a.primary.posted_days_ago || 0) - (b.primary.posted_days_ago || 0)) || a.primary.posting_id.localeCompare(b.primary.posting_id);
    });
    snapshot.counts = {
      postings: jobs.length, leads: leads.length,
      duplicateGroups: leads.filter(function (l) { return l.isDuplicate; }).length,
      eligible: leads.filter(function (l) { return l.eligibility.status === "eligible"; }).length,
      needs_check: leads.filter(function (l) { return l.eligibility.status === "needs_check"; }).length,
      duplicate_check: leads.filter(function (l) { return l.eligibility.status === "duplicate_check"; }).length,
      ineligible: leads.filter(function (l) { return l.eligibility.status === "ineligible"; }).length,
      flaggedSends: events.filter(function (e) { return e.event_type === "sent" && e.flags.length && !e.simulated; }).length
    };
    snapshot.funnel = HI.metrics.funnel(events);
    snapshot.notes = HI.quality.notes(snapshot);
    return snapshot;
  }

  // The latest outcome in the history for a lead, for display.
  function outcomeOf(l) {
    var order = ["client_won", "meeting_booked", "replied_positive", "unsubscribed", "replied_negative", "bounced", "opened", "delivered", "sent"];
    var types = l.history.map(function (e) { return e.event_type; });
    var best = order.filter(function (t) { return types.indexOf(t) >= 0; })[0];
    return best || null;
  }

  HI.pipeline = { run: run };
})(this.HI = this.HI || {});
