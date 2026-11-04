/*
 * rules.js: every business rule value in one place.
 * Changing a weight, keyword or schedule here changes the whole app. No logic lives here.
 * Each value traces back to a decision agreed during planning (R1–R7).
 */
(function (HI) {
  "use strict";

  HI.rules = {
    // "Today" for the simulation. null means the last event day found in events.csv.
    today: null,

    // R1: eligibility
    remotePolicies: ["GLOBAL", "US_ONLY", "ONSITE", "REMOTE_UNSPECIFIED"],
    ineligiblePolicies: { US_ONLY: "U.S. only", ONSITE: "On-site" },
    verifyPolicies: { REMOTE_UNSPECIFIED: "Remote policy not stated" },
    // A GLOBAL posting whose notes contain one of these goes to human check.
    verifyNoteKeywords: ["unclear local restriction"],
    // A title or required skill containing one of these means a local licence is required.
    licenceKeywords: ["licensed", "license", "licence"],

    // R1.2: duplicates (same domain + same role). If postings in a group disagree on
    // any of these fields, the group goes to Duplicate check and nothing is assumed.
    duplicateConflictFields: ["remote_policy", "us_hours_required", "required_skills", "role_key"],
    // These differences are shown as information only.
    duplicateInfoFields: ["company", "industry", "company_employees", "salary_usd_per_year", "notes"],

    // R2: priority score, 0–100
    weights: { eligibility: 30, fit: 40, urgency: 30 },
    eligibilityPoints: { eligible: 30, pending: 10 },
    fitPoints: { verified: 40, partialMax: 30 }, // partial = partialMax × (skills matched ÷ required)
    urgency: {
      urgentNoteKeywords: ["urgent"],
      urgentPoints: 10,
      freshness: [ { maxDays: 7, points: 10 }, { maxDays: 21, points: 5 } ],
      repeatPoints: 10,
      repeatNoteKeywords: ["reposted"],
      repeatWording: "reposted — may indicate ongoing need (not proof)"
    },

    // R3: matching
    matching: { partialMinSkills: 1, maxPartialsShown: 3 },
    // R3.3: a candidate is assigned to one lead at a time.
    assignment: { maxLeadsPerCandidate: 1 },

    // R4: drafts
    draft: {
      maxWords: 120,
      signOff: "[Your name], Real Hires",
      ask: "a 15-minute call",
      optOut: "If this isn't relevant, just reply \"no thanks\" and we won't contact you again."
    },

    // R5: events
    eventTypes: ["sent", "delivered", "opened", "bounced", "replied_positive", "replied_negative",
                 "meeting_booked", "client_won", "unsubscribed"],

    // R6: follow-ups. This matches the history in events.csv: step 2 three days after step 1, no step 3.
    sequence: [ { step: 1, offsetDays: 0 }, { step: 2, offsetDays: 3 } ],
    stopEvents: {
      replied_positive: { label: "Positive reply", outcome: "Handed to a person; automation stopped" },
      replied_negative: { label: "Negative reply", outcome: "Closed: not now. Re-engage only with approval, after 90 days and a new trigger" },
      bounced:          { label: "Bounce",         outcome: "Stopped until the address is fixed" },
      unsubscribed:     { label: "Unsubscribe",    outcome: "Permanent: never contact again" }
    },
    reengage: { coolOffDays: 90 },

    // S3: import limits
    import: { maxBytes: 5 * 1024 * 1024 },

    // R7.1: company-name hints, used only to flag noisy industry labels. Labels are never corrected.
    industryHints: [
      { word: "legal",      expect: ["Legal Services"] },
      { word: "accounting", expect: ["Accounting"] },
      { word: "ledger",     expect: ["Accounting"] },
      { word: "retail",     expect: ["E-commerce", "Retail"] },
      { word: "commerce",   expect: ["E-commerce", "Retail"] },
      { word: "logistics",  expect: ["Logistics"] },
      { word: "finance",    expect: ["Finance", "Business Services", "Accounting"] }
    ]
  };
})(this.HI = this.HI || {});
