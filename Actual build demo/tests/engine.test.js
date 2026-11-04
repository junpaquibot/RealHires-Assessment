/*
 * Engine tests. Zero dependencies. Run with:  node tests/engine.test.js
 * They load the same browser files the app uses (in a sandbox) and check the agreed outcomes.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.join(__dirname, "..");
const FILES = ["rules", "csv", "sample-data", "sources", "normalize", "dedup", "eligibility", "matching", "scoring",
  "campaign", "assignment", "followups", "metrics", "outreach", "quality", "pipeline"];

function load() {
  const ctx = vm.createContext({ console });
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" }));
  return ctx.HI;
}

const HI = load();
const run = (decisions) => HI.pipeline.run(HI.sources.loadSample(), decisions || {});
const S = run();
const lead = (snap, id) => snap.leads.find((l) => l.postingIds.includes(id));
const ids = (list) => list.map((l) => l.primary.posting_id).sort();

// Arrays built inside the sandbox have a different prototype, so compare plain JSON copies.
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✗ " + name + "\n      " + e.message); }
}

console.log("R1 · import, dedup, eligibility");
test("30 postings become 28 leads with 2 duplicate groups", () => {
  assert.strictEqual(S.counts.postings, 30);
  assert.strictEqual(S.counts.leads, 28);
  assert.strictEqual(S.counts.duplicateGroups, 2);
});
test("Northline auto-merges with JOB-002 (most recent) as primary", () => {
  const l = lead(S, "JOB-029");
  assert.strictEqual(l.primary.posting_id, "JOB-002");
  assert.strictEqual(l.resolution, "auto");
  same(l.postingIds, ["JOB-002", "JOB-029"]);
});
test("Harborwell goes to Duplicate check (remote policy + U.S. hours disagree)", () => {
  const l = lead(S, "JOB-030");
  assert.strictEqual(l.eligibility.status, "duplicate_check");
  same(l.conflicts.map((c) => c.field).sort(), ["remote_policy", "us_hours_required"]);
});
test("Status counts: 10 eligible · 7 needs check · 1 duplicate check · 10 ineligible", () => {
  same([S.counts.eligible, S.counts.needs_check, S.counts.duplicate_check, S.counts.ineligible], [10, 7, 1, 10]);
});
test("The exact eligible set", () => {
  same(ids(S.leads.filter((l) => l.eligibility.status === "eligible")),
    ["JOB-001", "JOB-002", "JOB-008", "JOB-011", "JOB-014", "JOB-016", "JOB-021", "JOB-022", "JOB-026", "JOB-028"]);
});
test("Needs-check set: remote unspecified + unclear local restriction", () => {
  same(ids(S.leads.filter((l) => l.eligibility.status === "needs_check")),
    ["JOB-005", "JOB-006", "JOB-012", "JOB-015", "JOB-018", "JOB-024", "JOB-025"]);
});
test("Licensed nurse roles are ineligible with the licence reason", () => {
  ["JOB-009", "JOB-019"].forEach((id) => {
    const l = lead(S, id);
    assert.strictEqual(l.eligibility.status, "ineligible");
    assert.ok(l.eligibility.licence);
  });
});
test("A reviewer confirming a needs-check lead makes it eligible; picking a duplicate record resolves it", () => {
  const key12 = lead(S, "JOB-012").key, key30 = lead(S, "JOB-030").key;
  const T = run({ checks: { [key12]: "eligible" }, duplicates: { [key30]: "JOB-004" } });
  assert.strictEqual(lead(T, "JOB-012").eligibility.status, "eligible");
  assert.strictEqual(lead(T, "JOB-030").eligibility.status, "eligible");
  assert.strictEqual(lead(T, "JOB-030").primary.posting_id, "JOB-004");
});

console.log("R2 · scoring");
test("Ineligible leads are not scored; pending leads are labelled pending", () => {
  assert.strictEqual(lead(S, "JOB-003").score, null);
  assert.strictEqual(lead(S, "JOB-005").score.pending, true);
});
test("Northline: 30 + 40 + urgent 10 + fresh 10 + repeat (linked duplicate) 10 = 100, capped urgency 30", () => {
  const sc = lead(S, "JOB-002").score;
  assert.strictEqual(sc.total, 100);
  assert.ok(sc.parts.urgency.reason.includes("not proof"));
});
test("Partial fit scales with skills: Customer Support (C-005 has 3/3 skills but not available) = 30", () => {
  assert.strictEqual(lead(S, "JOB-005").score.parts.fit.points, 30);
});
test("Every score is within 0–100 and equals the sum of its parts", () => {
  S.ranked.forEach((l) => {
    const p = l.score.parts;
    assert.strictEqual(l.score.total, p.eligibility.points + p.fit.points + p.urgency.points);
    assert.ok(l.score.total >= 0 && l.score.total <= 100);
  });
});

console.log("R3 · matching + assignment");
test("C-005 is never verified (available_now = no); C-009 is never verified for jobs that need U.S. hours", () => {
  S.leads.forEach((l) => l.matches.verified.forEach((m) => {
    assert.notStrictEqual(m.candidate.candidate_id, "C-005");
    if (l.primary.us_hours_required === "yes") assert.notStrictEqual(m.candidate.candidate_id, "C-009");
  }));
});
test("One candidate per lead: C-001 → JOB-001 (positive reply), C-002 → 022, C-008 → 028, C-004 → 014, C-006 → 026", () => {
  const got = {};
  S.profiles.forEach((p) => { if (p.assignedTo) got[p.candidate.candidate_id] = p.assignedTo.primary.posting_id; });
  same(got, { "C-001": "JOB-001", "C-002": "JOB-022", "C-004": "JOB-014", "C-006": "JOB-026", "C-008": "JOB-028" });
});
test("JOB-016 has a verified match but its candidate is assigned to Brookfield", () => {
  const l = lead(S, "JOB-016");
  assert.strictEqual(l.assignment, null);
  assert.strictEqual(l.blockedBy[0].posting_id, "JOB-026");
});
test("A recruiter move reassigns C-006 to JOB-016", () => {
  const T = run({ moves: { "C-006": lead(S, "JOB-016").key } });
  assert.strictEqual(lead(T, "JOB-016").assignment.candidate_id, "C-006");
  assert.strictEqual(lead(T, "JOB-026").assignment, null);
});

console.log("R4 · drafts");
test("Variant A only with an assigned verified candidate; never for JOB-016", () => {
  assert.strictEqual(lead(S, "JOB-016").drafts.A.available, false);
  assert.strictEqual(lead(S, "JOB-026").drafts.A.available, true);
  assert.ok(lead(S, "JOB-026").drafts.A.body.includes("C-006"));
});
test("Every draft is under 120 words and has an opt-out line", () => {
  S.leads.filter((l) => l.drafts.eligible).forEach((l) => ["A", "B"].forEach((v) => {
    const d = l.drafts[v];
    if (!d.available) return;
    assert.ok(d.words <= 120, l.primary.posting_id + " " + v + " has " + d.words + " words");
    assert.ok(d.body.includes("no thanks"));
  }));
});
test("No drafts for needs-check or ineligible leads", () => {
  assert.strictEqual(lead(S, "JOB-012").drafts.eligible, false);
  assert.strictEqual(lead(S, "JOB-003").drafts.eligible, false);
});

console.log("R5 · campaign tracking");
test("Duplicate opens don't inflate unique opens (JOB-001 has 3 opens → 1)", () => {
  const f = S.funnel.values.overall;
  assert.strictEqual(f.raw_opens, 17);
  assert.strictEqual(f.unique_opens, 15);
});
test("Overall funnel totals match the raw events", () => {
  const f = S.funnel.values.overall;
  same([f.sent, f.delivered, f.bounced, f.replied_positive, f.meeting_booked, f.client_won, f.unsubscribed],
    [26, 24, 2, 4, 2, 1, 2]);
});
test("A + B = overall for every metric", () => {
  HI.metrics.KEYS.forEach((k) => assert.strictEqual(S.funnel.values.A[k] + S.funnel.values.B[k], S.funnel.values.overall[k], k));
});
test("Sends to ineligible / unverified leads and A without a match are flagged", () => {
  const sent = (id) => S.events.find((e) => e.posting_id === id && e.event_type === "sent" && e.step === 1);
  assert.ok(sent("JOB-007").flags.some((f) => f.includes("ineligible")));
  assert.ok(sent("JOB-018").flags.some((f) => f.includes("before eligibility")));
  assert.ok(sent("JOB-005").flags.some((f) => f.includes("Variant A")));
  assert.strictEqual(sent("JOB-014").flags.length, 0);
});

console.log("R6 · stop rules + follow-ups");
test("JOB-004's unsubscribe also covers linked JOB-030 (same lead, same domain)", () => {
  const l = lead(S, "JOB-030");
  assert.ok(l.followups.check.stop && l.followups.check.stop.event_type === "unsubscribed");
});
test("Stopped contacts have no due or scheduled steps", () => {
  S.leads.filter((l) => S.stops[l.primary.domain]).forEach((l) =>
    l.followups.steps.forEach((s) => assert.ok(["sent", "cancelled"].includes(s.status), l.primary.posting_id + " step " + s.step + " is " + s.status)));
});
test("Step 2 is due now (day 4) for 014, 016, 022; 026 and 028 get step 1", () => {
  ["JOB-014", "JOB-016", "JOB-022"].forEach((id) => {
    const s2 = lead(S, id).followups.steps.find((s) => s.step === 2);
    assert.strictEqual(s2.status, "due"); assert.strictEqual(s2.day, 4);
  });
  ["JOB-026", "JOB-028"].forEach((id) => assert.strictEqual(lead(S, id).followups.steps[0].status, "due"));
});
test("A simulated reply cancels pending follow-ups for that contact", () => {
  const T = run({ simEvents: [{ posting_id: "JOB-014", event_type: "replied_negative", event_day: 4 }] });
  lead(T, "JOB-014").followups.steps.forEach((s) => assert.ok(["sent", "cancelled"].includes(s.status)));
  assert.strictEqual(T.funnel.values.overall.replied_negative, S.funnel.values.overall.replied_negative, "simulated events never touch history metrics");
});

console.log("Product build");
test("App-product.html contains every engine and product file unchanged (rebuild with node tools/build-product.js if this fails)", () => {
  const html = fs.readFileSync(path.join(root, "..", "App-product.html"), "utf8");
  FILES.map((f) => "js/" + f + ".js").concat(["js/store.js", "js/ui.js", "product/product-config.js", "product/product.js", "product/product.css"])
    .forEach((f) => assert.ok(html.includes(fs.readFileSync(path.join(root, f), "utf8")), f + " is out of date in App-product.html"));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
