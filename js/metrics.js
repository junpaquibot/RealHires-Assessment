/*
 * metrics.js: the campaign funnel by variant and overall (R5).
 * Unique opens count each message (posting + step) once, so duplicate opens can't inflate them.
 * The open rate is unique opens ÷ delivered, and is always shown as approximate.
 * Every metric also has a "⚠ flagged" count: events that belong to a send that broke our rules.
 */
(function (HI) {
  "use strict";

  var KEYS = ["sent", "delivered", "unique_opens", "bounced", "replied_positive", "replied_negative", "meeting_booked", "client_won", "unsubscribed"];
  var LABELS = {
    sent: "Messages sent", delivered: "Delivered", unique_opens: "Unique opens", bounced: "Bounces",
    replied_positive: "Positive replies", replied_negative: "Negative replies", meeting_booked: "Meetings booked",
    client_won: "Clients won", unsubscribed: "Unsubscribes"
  };

  function blank() { var o = {}; KEYS.forEach(function (k) { o[k] = 0; }); o.raw_opens = 0; return o; }

  // events: normalized events (already flagged). include(e) is an optional filter, e.g. for the dashboard's filters.
  function funnel(events, include) {
    var hist = events.filter(function (e) { return !e.ignored && !e.simulated && (!include || include(e)); });
    var flaggedMsg = {};
    hist.forEach(function (e) { if (e.event_type === "sent" && e.flags.length) flaggedMsg[HI.campaign.messageKey(e)] = true; });

    var out = { A: blank(), B: blank(), overall: blank() };
    var flagged = { A: blank(), B: blank(), overall: blank() };
    var opened = { A: {}, B: {}, overall: {} };

    hist.forEach(function (e) {
      var buckets = ["overall"];
      if (e.variant === "A" || e.variant === "B") buckets.push(e.variant);
      var fl = !!flaggedMsg[HI.campaign.messageKey(e)] || (e.event_type !== "sent" && e.flags.length > 0);
      buckets.forEach(function (b) {
        if (e.event_type === "opened") {
          out[b].raw_opens++;
          var mk = HI.campaign.messageKey(e);
          if (!opened[b][mk]) { opened[b][mk] = true; out[b].unique_opens++; if (fl) flagged[b].unique_opens++; }
          return;
        }
        if (out[b][e.event_type] !== undefined) { out[b][e.event_type]++; if (fl) flagged[b][e.event_type]++; }
      });
    });

    ["A", "B", "overall"].forEach(function (b) {
      var o = out[b];
      o.open_rate = o.delivered ? o.unique_opens / o.delivered : null;
      o.positive_rate = o.delivered ? o.replied_positive / o.delivered : null;
      o.duplicate_opens = o.raw_opens - o.unique_opens;
    });
    return { values: out, flagged: flagged, keys: KEYS, labels: LABELS };
  }

  HI.metrics = { funnel: funnel, KEYS: KEYS, LABELS: LABELS };
})(this.HI = this.HI || {});
