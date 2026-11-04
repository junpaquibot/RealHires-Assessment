# HireIntercept: Real Hires prototype

A small, working local prototype. It takes mock job postings, finds employers likely to need international remote staff, matches available candidates honestly, writes two outreach variants, simulates an A/B campaign with stop rules, and shows a dashboard.

**All data is synthetic. Nothing is sent, scraped or called.** The app makes no network requests at all.

---

## What's in here

| | File | What it's for | Standalone? |
|---|---|---|---|
| 1 | **`build-plan.html`** | The big picture: a clickable map of how every part connects (Input → The App → Dashboard → Employee), with the rules each part follows. | Yes. Works if moved anywhere. |
| 2 | **`App-product.html`** | **The product.** The dashboard the Real Hires team would use: ranked opportunities, leads with verification, campaign funnel, A/B comparison, stop rules. The engine and sample data are built in. | Yes. One file, works offline. |
| 3 | **`Actual build demo/index.html`** | The same app, split into its components (one JavaScript file each), for walking through how it's built and how each part would be deployed. | Needs its folder. |
| 4 | **`Actual build demo/explainer.html`** | Explains the Actual build demo, one component at a time: input → rule → output with live numbers, the code behind it, and its production equivalent. | Needs its folder. |

## Run it

**No install, no server and no keys are needed.** Double-click any of the HTML files above. They open in any modern browser (Chrome, Edge, Firefox or Safari), and the three sample CSVs load automatically.

**Optional extras** (need [Node.js](https://nodejs.org), no packages). Run them from inside `Actual build demo/`:

```bash
node tests/engine.test.js      # 27 checks on the agreed outcomes (counts, scores, stops, metrics)
node tools/build-product.js    # rebuild ../App-product.html after changing js/ or product/
node tools/embed-data.js       # re-embed data/*.csv into js/sample-data.js after editing a CSV
node tools/serve.js            # optional: serve over http://127.0.0.1:8765 instead of file://
```

**Signing in to `App-product.html`:** the demo account **admin / admin** is pre-filled, so just click **Log in**. The Register tab is a sample page and doesn't create accounts. This sign-in is a **demo gate, not security**: it runs in the browser, so anyone can read the credentials in the file. A real version would use server-side accounts, hashed passwords and sessions (see *What real integrations would need*).

`App-product.html` is generated: the build script copies the engine files from `js/` and the UI from `product/` into one file. The product and the demo therefore always give the same numbers. Edit the sources, not the generated file.

### Importing your own CSVs
In the **Actual build demo** (`index.html`), use **Import CSV…** to replace jobs, candidates or events. `App-product.html` always runs on the built-in sample data. Several files can be selected at once. The file type is detected from the header row.

- Files must use the same column names as `data/*.csv`. Extra columns are ignored.
- A file missing required columns, larger than 5 MB, or not a `.csv` is rejected, and the current data is kept.
- Bad rows are skipped or flagged under **Data notes**. They never crash the app.
- `Actual build demo/test-data/` has messy examples to try: whitespace, mixed case, URL-style domains, `$48,000` salaries, unknown policies, missing titles, duplicate IDs, a `<script>` company name, and a file with missing columns.

### Inspect before you run
Every file here is plain text. Open any `.html`, `.js` or `.css` file in Notepad to read it before running.

- **No dependencies, no external scripts, no network calls.** A Content-Security-Policy tag in each HTML file blocks outgoing connections, even if the code tried.
- **Imported data is only ever displayed as text, never as HTML.** A company name like `<script>…` is shown as characters, not run. The test files include one to prove it.
- Employee decisions are saved in your browser's local storage only. The product and the demo keep separate copies. **Reset decisions** clears them.

---

## How it works

One pure function, `pipeline.run(csvText, employeeDecisions)`, runs every step and returns a snapshot. This is the rules engine. The product, the demo and the explainer all render that same snapshot, so their numbers always match. Every weight, keyword and schedule lives in **`Actual build demo/js/rules.js`**. Paths below are inside `Actual build demo/`.

```
data/*.csv ─► sources + csv ─► normalize ─► dedup ─► eligibility ─► matching ─► scoring
                (retrieval)     (clean+flag)  (R1)      (R1)          (R3)        (R2)
                                                                              │
events.csv ─► campaign (link, stops, ⚠ flags) ─► assignment ─► follow-ups ─► outreach ─► metrics ─► notes
                       (R5)                        (R3.3)        (R6)          (R4)        (R5)      (R7)
                                                                              │
                                    store (decisions + audit log) ─► app.js / explainer.js ─► UI
```

| Layer | Files | Production equivalent |
|---|---|---|
| Data | `data/*.csv`, `js/sample-data.js` | Postgres tables |
| Retrieval | `js/sources.js`, `js/csv.js` | Apollo / job-feed sync + Finally Staff API client, run by a scheduler or webhooks |
| Normalize | `js/normalize.js` | The same code, inside the sync job |
| Leads logic | `js/dedup.js`, `js/eligibility.js`, `js/matching.js`, `js/scoring.js`, `js/assignment.js` | Backend service (TypeScript); the modules move over almost unchanged |
| Campaign logic | `js/outreach.js`, `js/campaign.js`, `js/followups.js`, `js/metrics.js` | Apollo sequences + webhooks; a delayed-job queue for follow-ups |
| Orchestration | `js/pipeline.js`, `js/rules.js`, `js/store.js` | API layer + a settings table + a decisions/audit table |
| UI | `index.html`, `explainer.html`, `js/app.js`, `js/explainer.js`, `js/ui.js`, `styles.css`; product UI in `product/` | The same UI, behind a login |

Plain JavaScript loaded with classic `<script>` tags, not modules, so it works from a double-clicked `file://` page with no build step.

---

## Data assumptions and rules

| Area | What the prototype does |
|---|---|
| **Duplicates (R1)** | Postings are grouped by normalized domain + role. The **most recent posting is the record** unless the postings disagree on remote policy, U.S. hours, required skills or title. Then the group goes to **Duplicate check** for a person to decide. Headcount, salary and notes differences are shown as information only. Every posting ID stays linked. |
| **Eligibility (R1)** | `US_ONLY` / `ONSITE` → ineligible. A title or skill containing "licensed"/"license" → ineligible: there's no licence data for candidates, so no candidate could be matched. `REMOTE_UNSPECIFIED`, or `GLOBAL` with the note "unclear local restriction" → **Needs human check**. These get no drafts or follow-ups until a person confirms them. Result: **30 postings → 28 leads: 10 eligible, 7 needs check, 1 duplicate check, 10 ineligible.** |
| **Score (R2)** | Eligibility 30 (clear GLOBAL 30, pending 10) + candidate fit 40 (verified 40; partial = 30 × share of skills matched) + urgency 30 ("urgent" +10; posted ≤ 7 days +10 or ≤ 21 days +5; repeat posting +10, worded "may indicate ongoing need, not proof"). Salary and company size are context only. Pending leads are scored for triage and labelled pending. Ineligible leads aren't scored. |
| **Matching (R3)** | **Verified** = every required skill + `available_now = yes` + U.S. hours if the job requires them. **Partial** = at least one skill, with gaps listed. A candidate is never described as available, or able to work U.S. hours, unless the data says yes. Every match is tagged *Synthetic data*. |
| **One candidate, one lead (R3)** | Each candidate is assigned to one lead at a time. Stopped contacts release theirs. A lead with a positive reply keeps theirs. Otherwise the highest score wins. A recruiter can **Move** a candidate, and the move is logged. |
| **Drafts (R4)** | Written for eligible leads only, including leads a person confirmed. **A** (candidate-first) only exists when a verified candidate is *assigned* to that lead. **B** (process/speed-first) uses a `[placeholder]` for turnaround rather than an unverified claim. Both are under 120 words, with one ask and an opt-out line. |
| **Tracking (R5)** | `events.csv` is history and is reported exactly as recorded. **Contact = company domain**, because there's no contact column. Unique opens count each message (posting + step) once. The open rate is unique opens ÷ delivered, always shown as **≈**. Historical sends that break today's rules are counted but flagged ⚠: sent to ineligible leads, sent before verification, or variant A with no verified candidate. |
| **Follow-ups (R6)** | The sequence matches the history: **step 1, then step 2 three days later; no step 3** (the data never sends one). "Today" = the last event day (day 4). Any reply, bounce or unsubscribe stops every pending step for that **domain**, including linked postings: JOB-004's unsubscribe also covers JOB-030. A negative reply closes the lead as "not now"; re-engagement needs approval, 90 days and a new trigger. Unsubscribes are permanent. The stop check runs right before every send. |
| **Dashboard (R7)** | Filters on industry and role, using the CSV's industry labels as given. Noisy labels (e.g. *Oakline Legal Group* listed as E-commerce) are listed under Data notes, not corrected. |

## Simplifications

- **No real sending.** Drafts are displayed only. The outbox, Apollo and Finally Staff are stubbed by the CSVs.
- **Browser storage instead of a database.** Reviewer decisions and the audit log live in this browser. Imported files last until the page is reloaded.
- **One sequence for everyone**, taken from the history. There are no per-variant timings or send windows (time zones, business days).
- **Keyword rules** for licences and unclear restrictions. They're explainable, but they'll miss phrasing they don't know (see risks).
- **The A/B test is too small to read.** About 13 sends per variant. The dashboard says so instead of naming a winner.
- **Simulated events** (Follow-ups tab) only affect stop rules. They never change the historical campaign numbers.

## What real integrations would need

**Apollo** (leads, contacts, sequences)
- An API key in a server-side secret store, never in the browser.
- **Pull:** company and job-posting data by search filters on a schedule. Contacts per company (name, title, verified email), which replaces "contact = domain".
- **Push:** approved drafts into Apollo sequences, one sequence per variant, with A/B assignment recorded in our database.
- **Webhooks** for sent, delivered, opened, replied, bounced and unsubscribed events, deduplicated by event ID, landing in an events table. Reply classification (positive/negative) needs a human or a classifier.
- Suppression lists synced both ways, so an unsubscribe in either system blocks both.
- Rate limits and retries handled by a job queue. A final stop check runs right before each API send call.

**Finally Staff** (candidates)
- A read API or scheduled export of candidate profiles: skills (ideally a shared taxonomy, not free text), `available_now` with a date, U.S.-hours availability, location and licences/certifications.
- A **reservation endpoint**, or at least a status field, so "assigned to one lead at a time" holds across both systems.
- Consent and data-sharing terms for mentioning a candidate in outreach. Variant A only references the candidate by ID and skills.

## Risks to address before production

**Technical: eligibility and matching depend on free-text fields.**
Remote policy, notes and skills come from job posts written by humans. Keyword rules like "licensed" or "unclear local restriction", and exact skill-name matching, will miss variants such as "must be based in Texas", "RN license" or "QBO" vs "QuickBooks". Before production we'd:
- add a skills synonym table and a location/licence phrase list, backed by tests built from real postings;
- measure how often the rules disagree with reviewers, using the review queue's decisions as labelled data;
- keep "unclear → human check" as the default, so misses fail safe.

**Commercial: deliverability and reputation.**
The history already shows sends to U.S.-only and unverified leads, and a follow-up sent to a licensed U.S.-only role. Cold outreach that ignores eligibility or stop signals gets marked as spam, damages the sending domain, and risks CAN-SPAM complaints. Before scaling we'd:
- use a separate warmed-up sending domain and enforce suppression across systems;
- cap daily volume;
- treat the prototype's ⚠ checks (eligible-only, verified-only variant A, stop check before every send) as hard gates in the send path, not just reports.

---

## Project structure

```
RealHires Assessment/
├── build-plan.html            1 · the map (standalone)
├── App-product.html           2 · the product dashboard (standalone, generated)
├── README.md
└── Actual build demo/
    ├── index.html             3 · component-by-component app
    ├── explainer.html         4 · explains the demo
    ├── styles.css             demo styles
    ├── js/                    the engine: one file per component (see "How it works")
    ├── product/               App-product sources: product.js, product.css, product.template.html
    ├── data/                  the original sample CSVs (synthetic)
    ├── test-data/             messy CSVs for trying the import
    ├── tests/engine.test.js   engine checks (node, no dependencies)
    └── tools/                 build-product.js, embed-data.js, serve.js
```
