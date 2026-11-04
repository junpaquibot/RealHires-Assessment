/*
 * followups.js: the follow-up schedule and stop rules (R6).
 * The sequence matches the history in events.csv: step 1, then step 2 three days later (rules.sequence).
 * canSend() is the stop check that runs right before every send (R6.5). Any reply, bounce or unsubscribe
 * on the contact's domain cancels every pending step, including steps for linked postings (R6.2, R6.3).
 */
(function (HI) {
  "use strict";

  function canSend(lead, stops) {
    var st = lead.eligibility.status;
    var stop = (stops[lead.primary.domain] || [])[0];
    if (stop) {
      var info = HI.rules.stopEvents[stop.event_type];
      var via = lead.postingIds.indexOf(stop.posting_id) >= 0
        ? (stop.posting_id === lead.primary.posting_id ? "" : " via linked posting " + stop.posting_id)
        : " via " + stop.posting_id + " (same company domain)";
      return { ok: false, kind: "cancelled", stop: stop,
        reason: info.label + " on day " + stop.event_day + " (" + stop.event_id + (stop.simulated ? ", simulated" : "") + ")" + via + ". " + info.outcome +
          (st === "ineligible" ? ". The lead is also ineligible." : "") };
    }
    if (st === "ineligible") return { ok: false, kind: "cancelled", reason: "Lead is ineligible (" + lead.eligibility.reasons[0] + ")" };
    if (st === "needs_check" || st === "duplicate_check") return { ok: false, kind: "paused", reason: "Paused until a person checks eligibility" };
    return { ok: true, kind: "clear", reason: "Stop check clear: no reply, bounce or unsubscribe for " + lead.primary.domain };
  }

  function schedule(lead, stops, today) {
    var seq = HI.rules.sequence;
    var sends = lead.history.filter(function (e) { return e.event_type === "sent" && !e.simulated; });
    var first = sends.filter(function (e) { return e.step === 1; })[0];
    var check = canSend(lead, stops);
    var startDay, contacted = !!first;

    if (contacted) startDay = first.event_day;
    else if (lead.eligibility.status === "ineligible") return { contacted: false, variant: null, steps: [], check: check };
    else startDay = today;

    var variant = first ? first.variant : null;
    var steps = seq.map(function (s) {
      var due = startDay + s.offsetDays;
      var sent = sends.filter(function (e) { return e.step === s.step; })[0];
      if (sent) return { step: s.step, day: sent.event_day, status: "sent", text: "Sent (" + sent.event_id + ")", flags: sent.flags };
      if (!check.ok) return { step: s.step, day: due, status: check.kind, text: check.reason, flags: [] };
      if (due <= today) return { step: s.step, day: due, status: "due", text: contacted ? "Due now. " + check.reason : "Ready: draft needs approval. " + check.reason, flags: [] };
      return { step: s.step, day: due, status: "scheduled", text: "Scheduled. The stop check runs again right before sending", flags: [] };
    });
    return { contacted: contacted, variant: variant, steps: steps, check: check };
  }

  // Log of every stop event and which pending steps it cancelled, across linked postings.
  function stopLog(leads, stops) {
    var out = [];
    Object.keys(stops).forEach(function (domain) {
      var list = stops[domain];
      var affected = leads.filter(function (l) { return l.primary.domain === domain; });
      list.forEach(function (s, i) {
        var cancelled = [];
        if (i === 0) {
          affected.forEach(function (l) {
            if (!l.followups || l.followups.check.stop !== s) return;
            l.followups.steps.forEach(function (st) {
              if (st.status === "cancelled") cancelled.push((l.primary.posting_id) + " step " + st.step + " (day " + st.day + ")");
            });
          });
        }
        out.push({
          event: s, domain: domain,
          company: affected[0] ? affected[0].primary.company : domain,
          postings: affected.reduce(function (a, l) { return a.concat(l.postingIds); }, []),
          outcome: HI.rules.stopEvents[s.event_type].outcome,
          cancelled: cancelled,
          firstStop: i === 0
        });
      });
    });
    return out.sort(function (a, b) { return a.event.event_day - b.event.event_day || a.event.order - b.event.order; });
  }

  HI.followups = { canSend: canSend, schedule: schedule, stopLog: stopLog };
})(this.HI = this.HI || {});
