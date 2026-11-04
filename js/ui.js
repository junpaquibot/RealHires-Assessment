/*
 * ui.js: tiny DOM helpers shared by both views.
 * Security (S1): data is only ever inserted as text (textContent / text nodes). There's no innerHTML anywhere,
 * so a company name like <script> in an imported CSV is shown as characters and never runs.
 */
(function (HI) {
  "use strict";

  // h("div", { class: "x", onclick: fn, title: "..." }, child, "text", [more children])
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === "object" && c.nodeType ? c : document.createTextNode(String(c)));
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  var STATUS = {
    eligible: { label: "Eligible", cls: "ok" },
    needs_check: { label: "Needs human check", cls: "warn" },
    duplicate_check: { label: "Duplicate check", cls: "warn" },
    ineligible: { label: "Ineligible", cls: "no" }
  };
  function status(s) { var m = STATUS[s] || { label: s, cls: "" }; return h("span", { class: "badge " + m.cls, text: m.label }); }
  function tag(text, cls) { return h("span", { class: "tag " + (cls || ""), text: text }); }
  function warn(text) { return h("span", { class: "flag", title: text, text: "⚠ " + text }); }
  function pct(x) { return x == null ? "—" : Math.round(x * 100) + "%"; }

  function scoreBar(score) {
    if (!score) return h("span", { class: "muted", text: "not scored" });
    var p = score.parts;
    return h("span", { class: "score" + (score.pending ? " pending" : ""), title: "Eligibility " + p.eligibility.points + " · Fit " + p.fit.points + " · Urgency " + p.urgency.points },
      h("b", { text: String(score.total) }),
      h("span", { class: "bar" },
        h("i", { class: "e", style: { width: p.eligibility.points + "%" } }),
        h("i", { class: "f", style: { width: p.fit.points + "%" } }),
        h("i", { class: "u", style: { width: p.urgency.points + "%" } })),
      score.pending ? h("small", { text: "pending" }) : null);
  }

  // A simple table. cols: [{ label, get(row) -> node|string, sort(row) -> value, cls }]
  function table(cols, rows, opts) {
    opts = opts || {};
    var state = { col: opts.sortCol == null ? -1 : opts.sortCol, dir: opts.sortDir || 1 };
    var wrap = h("div", { class: "table-wrap" });
    function render() {
      var data = rows.slice();
      if (state.col >= 0 && cols[state.col].sort) {
        var f = cols[state.col].sort;
        data.sort(function (a, b) { var x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * state.dir; });
      }
      var thead = h("tr", null, cols.map(function (c, i) {
        var arrow = state.col === i ? (state.dir > 0 ? " ▲" : " ▼") : "";
        return h("th", { class: (c.cls || "") + (c.sort ? " sortable" : ""), title: c.sort ? "Sort by " + c.label : null,
          onclick: c.sort ? function () { state.dir = state.col === i ? -state.dir : (c.defaultDir || 1); state.col = i; render(); } : null }, c.label + arrow);
      }));
      var body = data.length ? data.map(function (r) {
        return h("tr", { class: opts.rowClass ? opts.rowClass(r) : null, onclick: opts.onRow ? function () { opts.onRow(r); } : null, tabindex: opts.onRow ? "0" : null,
          onkeydown: opts.onRow ? function (ev) { if (ev.key === "Enter") opts.onRow(r); } : null },
          cols.map(function (c) { return h("td", { class: c.cls || null }, c.get(r)); }));
      }) : h("tr", null, h("td", { colspan: String(cols.length), class: "muted", text: opts.empty || "Nothing to show." }));
      clear(wrap).appendChild(h("table", { class: opts.onRow ? "click" : null }, h("thead", null, thead), h("tbody", null, body)));
    }
    render();
    return wrap;
  }

  HI.ui = { h: h, clear: clear, status: status, tag: tag, warn: warn, pct: pct, scoreBar: scoreBar, table: table, STATUS: STATUS };
})(this.HI = this.HI || {});
