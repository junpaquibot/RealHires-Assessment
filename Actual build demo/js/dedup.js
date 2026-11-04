/*
 * dedup.js: groups postings into leads by normalized domain + role (R1.2).
 * The most recent posting is the primary record, unless the postings disagree on a field that
 * affects eligibility or matching. Then the group goes to Duplicate check and a person decides.
 * Every posting ID stays linked, so nothing is thrown away.
 */
(function (HI) {
  "use strict";

  function fieldValue(job, f) {
    var v = job[f];
    if (Array.isArray(v)) return v.slice().sort().join("; ");
    return v == null ? "" : String(v);
  }

  var LABELS = {
    remote_policy: "Remote policy", us_hours_required: "U.S. hours required", required_skills: "Required skills",
    role_key: "Role title", company: "Company name", industry: "Industry", company_employees: "Employees",
    salary_usd_per_year: "Salary (USD/yr)", notes: "Notes"
  };

  function compare(postings, fields) {
    var out = [];
    fields.forEach(function (f) {
      var vals = postings.map(function (p) { return { posting_id: p.posting_id, value: fieldValue(p, f) }; });
      var distinct = {};
      vals.forEach(function (v) { distinct[v.value] = true; });
      if (Object.keys(distinct).length > 1) out.push({ field: f, label: LABELS[f] || f, values: vals });
    });
    return out;
  }

  // decisions.duplicates[key] = posting_id chosen by a person, or "ineligible"
  function group(jobs, decisions) {
    var byKey = {}, order = [];
    jobs.forEach(function (j) {
      var key = j.domain + "|" + j.role_key;
      if (!byKey[key]) { byKey[key] = []; order.push(key); }
      byKey[key].push(j);
    });

    return order.map(function (key) {
      var postings = byKey[key].slice().sort(function (a, b) {
        var da = a.posted_days_ago == null ? 1e9 : a.posted_days_ago;
        var db = b.posted_days_ago == null ? 1e9 : b.posted_days_ago;
        return da - db || (a.line - b.line);
      });
      var conflicts = compare(postings, HI.rules.duplicateConflictFields);
      var differences = compare(postings, HI.rules.duplicateInfoFields);
      var human = decisions && decisions.duplicates ? decisions.duplicates[key] : null;
      var primary = postings[0];
      var resolution = postings.length === 1 ? "single" : (conflicts.length ? "needs_check" : "auto");
      if (postings.length > 1 && human) {
        if (human === "ineligible") resolution = "human_ineligible";
        else {
          var picked = postings.filter(function (p) { return p.posting_id === human; })[0];
          if (picked) { primary = picked; resolution = "human_pick"; }
        }
      }
      return {
        key: key,
        primary: primary,
        postings: postings,
        postingIds: postings.map(function (p) { return p.posting_id; }),
        isDuplicate: postings.length > 1,
        conflicts: conflicts,
        differences: differences,
        resolution: resolution
      };
    });
  }

  HI.dedup = { group: group, LABELS: LABELS };
})(this.HI = this.HI || {});
