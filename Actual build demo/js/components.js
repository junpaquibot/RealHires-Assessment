/*
 * components.js: one description per component, shared by the simulator (simulator.html) and the guide (explainer.html).
 * It holds words only: what each part does, where its code lives, which rules it reads, and how it could be deployed.
 * The live numbers come from the pipeline at run time.
 */
(function (HI) {
  "use strict";

  var GROUPS = [
    { id: "input", label: "Input", color: "var(--in)" },
    { id: "processing", label: "Processing · rules engine", color: "var(--step)" },
    { id: "front", label: "Dashboard & employee", color: "var(--dash)" }
  ];

  var C = [
    { id: "jobs", group: "input", type: "in", title: "Job postings", req: "R1",
      what: "Loads the job CSV (the embedded sample or an imported file), checks it has the right columns, and parses it into rows.",
      takes: "Job CSV text", gives: "Raw job rows",
      file: "js/sources.js · js/csv.js", fn: "sources.parseKind", fnRef: function () { return HI.sources.parseKind; },
      rules: ["import.maxBytes"],
      deploy: [
        { name: "Scheduled sync from Apollo", pick: true, how: "A cron job (e.g. hourly) calls the Apollo API for new postings that match our filters and writes them to Postgres.", pros: ["Fresh data without anyone clicking", "Easy to retry and log"], cons: ["Needs API limits handled"] },
        { name: "Job-feed webhook", how: "A provider pushes new postings to our API as they appear.", pros: ["Near real-time"], cons: ["Depends on the provider supporting it", "Must verify each request"] },
        { name: "Manual CSV upload", how: "What the prototype does: someone exports a file and imports it.", pros: ["No integration work"], cons: ["Stale between uploads", "Easy to forget"] }
      ],
      prod: "Apollo API client + a scheduler (cron) in the backend." },
    { id: "candidates", group: "input", type: "in", title: "Candidates", req: "R3",
      what: "Loads the candidate pool: skills, availability now, and whether each person can work U.S. hours.",
      takes: "Candidate CSV text", gives: "Raw candidate rows",
      file: "js/sources.js · js/csv.js", fn: "sources.parseKind", fnRef: function () { return HI.sources.parseKind; },
      rules: [],
      deploy: [
        { name: "Nightly sync from Finally Staff", pick: true, how: "A scheduled job pulls candidate profiles and availability into our database.", pros: ["Matching runs on our own copy, fast and reliable"], cons: ["Availability can be up to a day old"] },
        { name: "Live lookup when matching", how: "Ask Finally Staff for candidates each time matching runs.", pros: ["Always current"], cons: ["Slower, and breaks if their API is down"] },
        { name: "CSV export", how: "What the prototype does.", pros: ["No integration work"], cons: ["Manual and stale"] }
      ],
      prod: "Finally Staff API client + nightly sync job. Candidate reservations written back so both systems agree." },
    { id: "events", group: "input", type: "in", title: "Campaign events", req: "R5",
      what: "Loads campaign activity (sends, deliveries, opens, replies, bounces, unsubscribes, meetings, wins). It's treated as history and never rewritten.",
      takes: "Events CSV text", gives: "Raw event rows",
      file: "js/sources.js · js/csv.js", fn: "sources.parseKind", fnRef: function () { return HI.sources.parseKind; },
      rules: ["eventTypes"],
      deploy: [
        { name: "Apollo webhooks", pick: true, how: "Apollo calls our API for every delivery, open, reply, bounce and unsubscribe. Each event is stored once, keyed by its ID.", pros: ["Stop rules react within seconds"], cons: ["Must deduplicate and verify signatures"] },
        { name: "Polling Apollo every few minutes", how: "A job asks Apollo for recent activity.", pros: ["Simpler to start"], cons: ["Replies are noticed late, so a follow-up could slip out"] },
        { name: "CSV export", how: "What the prototype does.", pros: ["Simple"], cons: ["Far too slow for stop rules"] }
      ],
      prod: "Webhook endpoint → events table (unique by event ID)." },

    { id: "normalize", group: "processing", type: "step", title: "Normalize", req: "R1",
      what: "Cleans every value: trims spaces, lower-cases domains, splits skill lists, and standardises yes/no answers. Unknown values are flagged, never guessed.",
      takes: "Raw rows", gives: "Clean jobs, candidates and events + a list of issues",
      file: "js/normalize.js", fn: "normalize.jobs", fnRef: function () { return HI.normalize.jobs; },
      rules: ["remotePolicies"],
      deploy: [
        { name: "Same code inside the sync job", pick: true, how: "The function runs on every incoming row before it's saved.", pros: ["One place for cleaning rules", "Already tested"], cons: [] },
        { name: "Database constraints", how: "Let Postgres reject bad values.", pros: ["A good second safety net"], cons: ["Rejects instead of explaining"] },
        { name: "No-code ETL tool", how: "Clean data in a tool like n8n or Zapier.", pros: ["Quick to set up"], cons: ["Hard to test and version"] }
      ],
      prod: "Runs in the backend worker before writing to the database." },
    { id: "dedup", group: "processing", type: "step", title: "Deduplicate", req: "R1",
      what: "Groups postings by company domain + role. The most recent posting is the record, unless the repeats disagree on remote policy, U.S. hours, skills or title. Then an employee decides.",
      takes: "Clean jobs", gives: "Unique leads, each with its linked postings",
      file: "js/dedup.js", fn: "dedup.group", fnRef: function () { return HI.dedup.group; },
      rules: ["duplicateConflictFields", "duplicateInfoFields"],
      deploy: [
        { name: "Unique key in Postgres + review table", pick: true, how: "Leads are unique on (domain, role). Conflicts go to a review table that the dashboard reads.", pros: ["The database guarantees no doubles"], cons: [] },
        { name: "Fuzzy matching service", how: "Also catch near-duplicates (\"Sr. Bookkeeper\" vs \"Bookkeeper\").", pros: ["Catches more"], cons: ["More false matches, so it needs review"] }
      ],
      prod: "A database unique key plus a duplicate-review queue." },
    { id: "eligibility", group: "processing", type: "step", title: "Eligibility check", req: "R1",
      what: "Decides if a lead can be filled from overseas. U.S.-only, on-site and licensed roles are ineligible. Anything unclear waits for an employee.",
      takes: "Unique leads + employee decisions", gives: "Eligible / needs verification / ineligible, with reasons",
      file: "js/eligibility.js", fn: "eligibility.evaluate", fnRef: function () { return HI.eligibility.evaluate; },
      rules: ["ineligiblePolicies", "verifyPolicies", "verifyNoteKeywords", "licenceKeywords"],
      deploy: [
        { name: "Rules in the backend + review queue", pick: true, how: "The same rules run on the server. Unclear leads appear in a queue for an employee.", pros: ["Explainable and testable"], cons: ["Keyword rules miss new phrasing"] },
        { name: "AI classifier as a helper", how: "A language model suggests a label for free-text policies, and an employee confirms.", pros: ["Handles messy wording"], cons: ["Must never decide alone", "Costs per call"] }
      ],
      prod: "Backend rule function + verification queue table." },
    { id: "matching", group: "processing", type: "step", title: "Candidate matching", req: "R3",
      what: "Compares required skills with each candidate. Verified = all skills, available now, and U.S. hours if needed. Each candidate is then assigned to one company at a time.",
      takes: "Eligible leads + candidates", gives: "Verified / partial matches + who is assigned where",
      file: "js/matching.js · js/assignment.js", fn: "matching.forLead", fnRef: function () { return HI.matching.forLead; },
      rules: ["matching", "assignment"],
      deploy: [
        { name: "Backend function over the candidate table", pick: true, how: "Runs when leads or candidates change. Assignments are stored as reservations.", pros: ["Simple and fast at this size"], cons: [] },
        { name: "Search index", how: "Postgres full-text or a search engine once the pool is large.", pros: ["Scales to thousands"], cons: ["More moving parts"] },
        { name: "Skills taxonomy", how: "Map synonyms (\"QBO\" = \"QuickBooks\") before matching.", pros: ["Fewer missed matches"], cons: ["Needs upkeep"] }
      ],
      prod: "Matching service + candidate reservation table." },
    { id: "scoring", group: "processing", type: "step", title: "Priority scoring", req: "R2",
      what: "Scores each lead 0–100: remote eligibility (30) + candidate fit (40) + urgency or repeat-posting signals (30). Every point has a reason.",
      takes: "Leads + matches", gives: "Score + three-part breakdown",
      file: "js/scoring.js", fn: "scoring.score", fnRef: function () { return HI.scoring.score; },
      rules: ["weights", "eligibilityPoints", "fitPoints", "urgency"],
      deploy: [
        { name: "Compute on change, store with reasons", pick: true, how: "Recalculate when a lead changes; save the score and its reasons.", pros: ["Fast dashboard", "History of why scores changed"], cons: [] },
        { name: "Compute on read", how: "Calculate every time the dashboard loads.", pros: ["Always current"], cons: ["Slower as leads grow"] }
      ],
      prod: "Backend function; weights move from rules.js to a settings table." },
    { id: "outreach", group: "processing", type: "step", title: "Outbound variants", req: "R4",
      what: "Writes two short, truthful first emails per eligible lead. A is candidate-first and only exists with a verified, assigned candidate. B is process/speed-first.",
      takes: "Eligible leads + assigned candidates", gives: "Email drafts A and B",
      file: "js/outreach.js", fn: "outreach.drafts", fnRef: function () { return HI.outreach.drafts; },
      rules: ["draft"],
      deploy: [
        { name: "Templates pushed to Apollo sequences", pick: true, how: "One sequence per variant. Our app decides who goes in which, after approval.", pros: ["Apollo handles sending and tracking"], cons: ["Tied to Apollo"] },
        { name: "Own email service", how: "Send through SendGrid or Postmark with our own scheduler.", pros: ["Full control"], cons: ["We own deliverability and compliance"] }
      ],
      prod: "Template store + Apollo sequence API. Drafts approved by an employee before sending." },
    { id: "suppression", group: "processing", type: "gate", title: "Suppression check", req: "R6",
      what: "The last check right before any send. A reply, bounce or unsubscribe on that company, or an ineligible lead, stops the email.",
      takes: "One email about to go", gives: "Send, or stop with a reason",
      file: "js/followups.js", fn: "followups.canSend", fnRef: function () { return HI.followups.canSend; },
      rules: ["stopEvents"],
      deploy: [
        { name: "Called by the send worker, right before the API call", pick: true, how: "Every send job runs the check first, using the latest events.", pros: ["Catches replies that arrived after scheduling"], cons: [] },
        { name: "Apollo's own suppression list", how: "Sync our stop list into Apollo too.", pros: ["A second safety net"], cons: ["Not enough on its own"] }
      ],
      prod: "A function in the send worker + a suppression table synced with Apollo." },
    { id: "tracking", group: "processing", type: "step", title: "Campaign tracking", req: "R5",
      what: "Counts sent, delivered, unique opens, bounces, replies, meetings and clients won, for A, B and overall. Repeat opens of one email count once.",
      takes: "Events linked to leads", gives: "Funnel numbers + ⚠ flagged counts",
      file: "js/campaign.js · js/metrics.js", fn: "metrics.funnel", fnRef: function () { return HI.metrics.funnel; },
      rules: ["eventTypes"],
      deploy: [
        { name: "Database view / nightly rollup", pick: true, how: "A SQL view computes the funnel from the events table.", pros: ["One source of truth"], cons: [] },
        { name: "BI tool on top", how: "Metabase or Looker for ad-hoc questions.", pros: ["Flexible charts"], cons: ["Another tool to manage"] }
      ],
      prod: "SQL view over the events table." },
    { id: "stops", group: "processing", type: "step", title: "Stop rules & follow-ups", req: "R6",
      what: "Plans each follow-up (email 2 three days after email 1, matching the history) and cancels every pending one when that company replies, bounces or unsubscribes.",
      takes: "Events + schedule", gives: "Due, scheduled, paused or cancelled steps + a stop log",
      file: "js/followups.js", fn: "followups.schedule", fnRef: function () { return HI.followups.schedule; },
      rules: ["sequence", "reengage"],
      deploy: [
        { name: "Job queue with delayed jobs", pick: true, how: "Each follow-up is a job set to run on its day (e.g. pg-boss or BullMQ). The job runs the suppression check first.", pros: ["Exact timing, retries, easy to cancel"], cons: ["Needs a worker process"] },
        { name: "Apollo sequences", how: "Let Apollo handle follow-up timing; it pauses on reply.", pros: ["Less to build"], cons: ["Our extra rules (eligibility, linked postings) still need our check"] },
        { name: "Cron scan every 15 minutes", how: "A job looks for due follow-ups and sends them.", pros: ["Simple"], cons: ["Less precise timing"] }
      ],
      prod: "Worker + delayed-job queue; every job calls canSend() first." },

    { id: "dashboard", group: "front", type: "dash", title: "Dashboard", req: "R7",
      what: "The front-end: ranked opportunities, data and filters, leads, candidates, campaign funnel and A/B comparison. It only shows results; it makes no decisions.",
      takes: "The snapshot from pipeline.run()", gives: "Screens for the team",
      file: "index.html + product/ (packed into ../App-product.html)", fn: "pipeline.run", fnRef: function () { return HI.pipeline.run; },
      rules: [],
      deploy: [
        { name: "Same UI served by the backend, behind a login", pick: true, how: "A PaaS (Render, Railway or Fly.io) hosts the web app and API together.", pros: ["One deploy, simple ops"], cons: [] },
        { name: "Static front-end + serverless API", how: "Vercel or Netlify for the UI, Supabase for the database and auth.", pros: ["Cheap at low traffic"], cons: ["Workers and queues need another home"] }
      ],
      prod: "Web app + API on a PaaS, with Postgres and a worker alongside." },
    { id: "employee", group: "front", type: "emp", title: "Employee decisions", req: "R1",
      what: "Everything a person decides: verifying unclear leads, picking the record for conflicting repeats, and moving candidates. Every decision is logged and can be undone.",
      takes: "Clicks on the dashboard", gives: "Decisions that re-run the pipeline + an audit log",
      file: "js/store.js", fn: "store.setCheck", fnRef: function () { return HI.store.setCheck; },
      rules: [],
      deploy: [
        { name: "Company login (SSO) + decisions table", pick: true, how: "Staff sign in with Google Workspace or Microsoft. Each decision is saved with who and when.", pros: ["Real accountability", "No extra passwords"], cons: [] },
        { name: "Email + password accounts", how: "Our own accounts with hashed passwords.", pros: ["No identity provider needed"], cons: ["We must handle resets and security"] }
      ],
      prod: "Auth provider + decisions and audit tables. The prototype keeps these in the browser only." }
  ];

  HI.components = { GROUPS: GROUPS, list: C, byId: function (id) { return C.filter(function (c) { return c.id === id; })[0]; } };
})(this.HI = this.HI || {});
