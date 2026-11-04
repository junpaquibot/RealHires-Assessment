/*
 * assignment.js: R3.3. Each candidate is offered to only one lead at a time.
 * Order:
 *   1. Leads stopped by a negative reply, bounce or unsubscribe don't hold a candidate.
 *   2. A manual move by a recruiter wins.
 *   3. Leads that already replied positively keep their candidate.
 *   4. Then by score, highest first. Ties go to the more recent posting, then the posting ID.
 */
(function (HI) {
  "use strict";

  var RELEASES = { replied_negative: 1, bounced: 1, unsubscribed: 1 };

  function stopState(lead, stops) {
    var list = stops[lead.primary.domain] || [];
    var release = list.filter(function (s) { return RELEASES[s.event_type]; })[0] || null;
    var positive = list.filter(function (s) { return s.event_type === "replied_positive"; })[0] || null;
    return { release: release, positive: positive };
  }

  function run(leads, stops, decisions) {
    var moves = (decisions && decisions.moves) || {};
    var taken = {}; // candidate_id -> { leadKey, via }
    var byKey = {};
    leads.forEach(function (l) { byKey[l.key] = l; l.assignment = null; l.blockedBy = []; l.assignmentNote = null; });

    var active = leads.filter(function (l) {
      if (l.eligibility.status !== "eligible") return false;
      var s = stopState(l, stops);
      if (s.release) { l.assignmentNote = "Doesn't hold a candidate: contact stopped (" + s.release.event_type + " on day " + s.release.event_day + ")"; return false; }
      return true;
    });

    // 2. manual moves
    Object.keys(moves).forEach(function (cid) {
      var lead = byKey[moves[cid]];
      if (!lead || active.indexOf(lead) < 0 || lead.assignment) return;
      if (!lead.matches.verified.some(function (m) { return m.candidate.candidate_id === cid; })) return;
      taken[cid] = { leadKey: lead.key, via: "moved" };
      lead.assignment = { candidate_id: cid, via: "moved", text: "Moved here by a recruiter" };
    });

    // 3 + 4. replies first, then score
    var ordered = active.slice().sort(function (a, b) {
      var pa = stopState(a, stops).positive ? 1 : 0, pb = stopState(b, stops).positive ? 1 : 0;
      return (pb - pa) || ((b.score ? b.score.total : 0) - (a.score ? a.score.total : 0)) ||
        ((a.primary.posted_days_ago || 0) - (b.primary.posted_days_ago || 0)) || a.primary.posting_id.localeCompare(b.primary.posting_id);
    });
    ordered.forEach(function (lead) {
      if (lead.assignment) return;
      var positive = stopState(lead, stops).positive;
      var free = lead.matches.verified.filter(function (m) { return !taken[m.candidate.candidate_id]; })[0];
      if (free) {
        var via = positive ? "reply" : "score";
        taken[free.candidate.candidate_id] = { leadKey: lead.key, via: via };
        lead.assignment = { candidate_id: free.candidate.candidate_id, via: via,
          text: positive ? "Held: this lead replied positively (" + positive.event_id + ")" : "Highest-scoring lead for this candidate" };
      }
    });

    // Explain who holds each verified candidate a lead couldn't get.
    leads.forEach(function (lead) {
      lead.matches.verified.forEach(function (m) {
        var t = taken[m.candidate.candidate_id];
        if (t && t.leadKey !== lead.key) {
          var other = byKey[t.leadKey];
          lead.blockedBy.push({ candidate_id: m.candidate.candidate_id, leadKey: t.leadKey, company: other.primary.company, posting_id: other.primary.posting_id });
        }
      });
    });

    var byCandidate = {};
    Object.keys(taken).forEach(function (cid) { byCandidate[cid] = taken[cid]; });
    return byCandidate;
  }

  HI.assignment = { run: run, stopState: stopState };
})(this.HI = this.HI || {});
