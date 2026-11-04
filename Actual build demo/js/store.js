/*
 * store.js: app state shared by both views. It holds the loaded CSV text, the reviewer decisions, and the audit log.
 * Reviewer decisions are saved in this browser (localStorage) so a page reload keeps them. Imported files
 * aren't saved; a reload goes back to the sample data. In production this becomes the database.
 */
(function (HI) {
  "use strict";

  var KEY = HI.storeKey || "hireintercept-decisions-v1"; // App-product.html sets its own key
  var texts = HI.sources.loadSample();
  var decisions = blank();
  var listeners = [];
  var snapshot = null;

  function blank() { return { checks: {}, duplicates: {}, moves: {}, simEvents: [], audit: [] }; }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        decisions = blank();
        ["checks", "duplicates", "moves"].forEach(function (k) { if (d[k] && typeof d[k] === "object") decisions[k] = d[k]; });
        if (Array.isArray(d.simEvents)) decisions.simEvents = d.simEvents;
        if (Array.isArray(d.audit)) decisions.audit = d.audit;
      }
    } catch (e) { decisions = blank(); }
  }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(decisions)); } catch (e) { /* storage blocked: decisions last for this visit only */ } }

  function run() {
    snapshot = HI.pipeline.run(texts, decisions);
    listeners.forEach(function (fn) { fn(snapshot); });
    return snapshot;
  }

  function log(action, detail) {
    decisions.audit.unshift({ at: new Date().toISOString(), action: action, detail: detail });
    if (decisions.audit.length > 200) decisions.audit.length = 200;
  }

  function change(mutator, action, detail) {
    mutator(decisions);
    log(action, detail);
    save();
    return run();
  }

  HI.store = {
    init: function () { load(); return run(); },
    snapshot: function () { return snapshot; },
    texts: function () { return texts; },
    decisions: function () { return decisions; },
    onChange: function (fn) { listeners.push(fn); },
    setCheck: function (lead, value) {
      return change(function (d) { if (value) d.checks[lead.key] = value; else delete d.checks[lead.key]; },
        value ? "Eligibility " + (value === "eligible" ? "confirmed" : "rejected") : "Eligibility decision undone",
        lead.primary.company + " · " + lead.primary.title + " (" + lead.postingIds.join(" + ") + ")");
    },
    setDuplicate: function (lead, value) {
      return change(function (d) { if (value) d.duplicates[lead.key] = value; else delete d.duplicates[lead.key]; },
        value ? (value === "ineligible" ? "Duplicate group marked ineligible" : "Duplicate record picked: " + value) : "Duplicate decision undone",
        lead.primary.company + " (" + lead.postingIds.join(" + ") + ")");
    },
    move: function (candidateId, lead) {
      return change(function (d) {
        Object.keys(d.moves).forEach(function (c) { if (d.moves[c] === lead.key) delete d.moves[c]; });
        d.moves[candidateId] = lead.key;
      }, "Candidate moved", candidateId + " → " + lead.primary.company + " (" + lead.primary.posting_id + ")");
    },
    clearMove: function (candidateId) {
      return change(function (d) { delete d.moves[candidateId]; }, "Candidate move undone", candidateId + " back to automatic assignment");
    },
    addSim: function (ev) {
      return change(function (d) { d.simEvents.push(ev); }, "Simulated event added", ev.event_type + " for " + ev.posting_id + " on day " + ev.event_day);
    },
    clearSims: function () {
      return change(function (d) { d.simEvents = []; }, "Simulated events cleared", "History is back to events.csv only");
    },
    resetDecisions: function () {
      var audit = decisions.audit;
      decisions = blank();
      decisions.audit = audit;
      log("All reviewer decisions reset", "Checks, duplicate picks, moves and simulations cleared");
      save();
      return run();
    },
    // Replace one dataset with an imported file. Headers are checked first, and a bad file changes nothing.
    importText: function (kind, text, name) {
      HI.sources.parseKind(kind, text); // throws a readable error on missing columns
      var next = {};
      Object.keys(texts).forEach(function (k) { next[k] = texts[k]; });
      next[kind] = { text: text, name: name, origin: "imported" };
      HI.pipeline.run(next, decisions); // dry run: if this throws, nothing changes
      texts = next;
      log("File imported", kind + " ← " + name);
      save();
      return run();
    },
    loadSample: function () {
      texts = HI.sources.loadSample();
      log("Sample data loaded", "jobs, candidates and events reset to the embedded sample");
      save();
      return run();
    }
  };
})(this.HI = this.HI || {});
