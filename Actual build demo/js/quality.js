/*
 * quality.js: data-quality notes (R7.1). Nothing here changes the data. It only lists things a person should know.
 */
(function (HI) {
  "use strict";

  function notes(snapshot) {
    var out = [];
    var add = function (area, text, ids) { out.push({ area: area, text: text, ids: ids || [] }); };

    // Industry labels that don't fit the company name. They're flagged, never corrected.
    snapshot.jobs.forEach(function (j) {
      var name = j.company.toLowerCase();
      HI.rules.industryHints.forEach(function (h) {
        if (name.indexOf(h.word) >= 0 && h.expect.indexOf(j.industry) < 0) {
          add("Industry label", j.company + " (" + j.posting_id + ") is listed as \"" + j.industry + "\". The name suggests " + h.expect[0] + ". Filters use the label as given.", [j.posting_id]);
        }
      });
    });

    // Differences inside duplicate groups that were shown as information only.
    snapshot.leads.forEach(function (l) {
      l.differences.forEach(function (d) {
        add("Duplicate details", l.primary.company + ", " + d.label.toLowerCase() + ": " +
          d.values.map(function (v) { return v.posting_id + " = " + (v.value || "blank"); }).join(" vs ") + ". Shown for information; the most recent posting is used.", l.postingIds);
      });
    });

    // Opens: duplicate opens and replies without a recorded open.
    var byMsg = {};
    snapshot.events.forEach(function (e) {
      if (e.simulated || e.ignored) return;
      var k = HI.campaign.messageKey(e);
      (byMsg[k] = byMsg[k] || { opens: [], replies: [], posting: e.posting_id, step: e.step });
      if (e.event_type === "opened") byMsg[k].opens.push(e.event_id);
      if (/^replied_/.test(e.event_type)) byMsg[k].replies.push(e.event_id);
    });
    Object.keys(byMsg).forEach(function (k) {
      var m = byMsg[k];
      if (m.opens.length > 1) add("Open tracking", m.posting + " step " + m.step + " has " + m.opens.length + " open events (" + m.opens.join(", ") + "). Counted as 1 unique open.", [m.posting]);
      if (m.replies.length && !m.opens.length) add("Open tracking", m.posting + " replied (" + m.replies.join(", ") + ") with no recorded open. Open tracking misses some opens, so the open rate is approximate.", [m.posting]);
    });

    // Follow-ups the history didn't send.
    var today = snapshot.today, missed = [], sentStep2 = [];
    snapshot.leads.forEach(function (l) {
      var s1 = l.history.filter(function (e) { return e.event_type === "sent" && e.step === 1 && !e.simulated; })[0];
      if (!s1) return;
      var s2 = l.history.filter(function (e) { return e.event_type === "sent" && e.step === 2; })[0];
      var stop = (snapshot.stops[l.primary.domain] || []).filter(function (s) { return !s.simulated; })[0];
      if (s2) sentStep2.push(l.primary.posting_id);
      else if (!stop && s1.event_day + (HI.rules.sequence[1] ? HI.rules.sequence[1].offsetDays : 0) <= today) missed.push(l.primary.posting_id);
    });
    if (missed.length) add("Follow-up history", "Step 2 was sent for " + sentStep2.length + " lead(s) (" + sentStep2.join(", ") + "), but not for " + missed.length +
      " others with no stop event (" + missed.join(", ") + "). The schedule treats eligible ones as due now.", missed);

    snapshot.importIssues.forEach(function (i) { add("Import", i.where + ": " + i.text, []); });
    if (snapshot.orphans.length) {
      var orphanIds = snapshot.orphans.map(function (e) { return e.posting_id; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
      add("Events", snapshot.orphans.length + " event(s) refer to " + orphanIds.length + " posting(s) that aren't in the jobs file (" + orphanIds.slice(0, 8).join(", ") + (orphanIds.length > 8 ? ", …" : "") + "). They're counted in campaign totals as recorded, but can't be linked to a lead.", orphanIds);
    }
    return out;
  }

  HI.quality = { notes: notes };
})(this.HI = this.HI || {});
