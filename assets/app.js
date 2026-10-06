/* CEO Signal - front end. Data comes from window.CEO_DATA (data/site-data.js). */
(function () {
  "use strict";

  const DATA = window.CEO_DATA;
  const $ = (sel) => document.querySelector(sel);
  const MAX_COMPARE = 4;
  const TODAY = new Date();

  if (!DATA) {
    document.body.insertAdjacentHTML("afterbegin", '<p style="padding:16px">Data file missing - run <code>python scripts/build_data.py</code>.</p>');
    return;
  }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const domain = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; } };
  const src = (url) => url ? `<a class="src" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">${esc(domain(url))} ↗</a>` : "";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) {
    if (!d) return "";
    const [y, m] = String(d).split("-");
    return m ? `${MONTHS[+m - 1]} ${y}` : y;
  }
  function yearsSince(d) {
    if (!d) return null;
    const [y, m = 1, day = 1] = String(d).split("-").map(Number);
    const yrs = (TODAY - new Date(y, m - 1, day)) / (365.25 * 864e5);
    return yrs < 1 ? `${Math.max(1, Math.round(yrs * 12))} mo` : `${Math.floor(yrs)} yr${Math.floor(yrs) === 1 ? "" : "s"}`;
  }
  function lastName(name) {
    const clean = name.replace(/\(.*?\)/g, "").replace(/,?\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();
    const parts = clean.split(/\s+/);
    return parts[parts.length - 1];
  }
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // ---------- model ----------
  const records = DATA.companies.map((c) => {
    const ps = DATA.profiles[c.id] || [];
    const p = ps[0] || null;
    const names = ps.length ? ps.map((x) => x.name) : c.ceo.names;
    return {
      id: c.id,
      rank: c.rank,
      company: c.company,
      sector: c.sector,
      industry: c.industry,
      names,
      ceoLabel: names.join(" & "),
      interim: c.ceo.interim,
      coCeo: c.ceo.co_ceo,
      since: (p && p.tenure && p.tenure.start) || c.ceo.since,
      notes: c.notes,
      sources: c.sources || [],
      profile: p,
      profiles: ps,
      search: norm([names.join(" "), c.company, c.ticker || "", c.industry].join(" ")),
    };
  });
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));
  const profiled = records.filter((r) => r.profile);
  // one entry per CEO (co-CEO companies contribute two) - used for counts, filters and charts
  const people = records.flatMap((r) => r.profiles.map((p) => ({ rec: r, p, name: p.name })));

  const state = { sector: "All", query: "", filters: {}, sort: { key: "rank", dir: 1 }, compare: [] };

  // ---------- header stats ----------
  const sectors = [...new Set(records.map((r) => r.sector))].sort();
  $("#stats").innerHTML = [
    `<span class="stat"><b>${records.length}</b>companies</span>`,
    `<span class="stat"><b>${people.length}</b>CEO profiles</span>`,
    `<span class="stat"><b>${sectors.length}</b>industries</span>`,
    `<span class="stat">CEO list checked <b>${esc(DATA.checked || "")}</b></span>`,
  ].join("");
  $("#built").textContent = `Data built ${DATA.built}.`;

  // ---------- tabs ----------
  function renderTabs() {
    const counts = {};
    records.forEach((r) => (counts[r.sector] = (counts[r.sector] || 0) + 1));
    const tabs = [["All", records.length], ...sectors.map((s) => [s, counts[s]])];
    $("#tabs").innerHTML = tabs.map(([s, n]) =>
      `<button class="tab" role="tab" aria-selected="${s === state.sector}" data-sector="${esc(s)}">${esc(s)}<span class="n">${n}</span></button>`).join("");
  }
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.sector = b.dataset.sector;
    renderTabs();
    renderTable();
  });

  // ---------- dropdown (A-Z) ----------
  const entries = [];
  records.forEach((r) => r.names.forEach((n) => entries.push({ id: r.id, name: n, last: lastName(n), company: r.company })));
  entries.sort((a, b) => a.last.localeCompare(b.last) || a.name.localeCompare(b.name));
  $("#jump").insertAdjacentHTML("beforeend", entries.map((e) =>
    `<option value="${esc(e.id)}">${esc(e.last)}, ${esc(e.name.replace(new RegExp("\\s*" + e.last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*$"), "").replace(/\(.*?\)/g, "").trim())} - ${esc(e.company)}</option>`).join(""));
  $("#jump").addEventListener("change", (e) => {
    if (e.target.value) openProfile(e.target.value);
    e.target.value = "";
  });

  // ---------- search ----------
  $("#search").addEventListener("input", (e) => {
    state.query = norm(e.target.value.trim());
    renderTable();
  });

  // ---------- table ----------
  function eduSummary(r) {
    if (!r.profiles.length) return '<span class="na">-</span>';
    return r.profiles.map((p) => {
      const who = r.profiles.length > 1 ? `<span class="muted">${esc(lastName(p.name))}:</span> ` : "";
      if (!p.education || !p.education.length) return who + '<span class="na">Not publicly available</span>';
      const byInst = new Map();
      p.education.forEach((e) => { if (!byInst.has(e.institution)) byInst.set(e.institution, []); if (e.degree) byInst.get(e.institution).push(e.degree); });
      return who + [...byInst].map(([inst, degs]) => `${esc(inst)}${degs.length ? ` <span class="muted">(${esc(degs.join(", "))})</span>` : ""}`).join("; ");
    }).join("<br>");
  }
  function visibleRecords() {
    let rows = records.filter((r) =>
      (state.sector === "All" || r.sector === state.sector) &&
      (!state.query || r.search.includes(state.query)) &&
      (!anyFilter() || passesFilters(r)));
    const { key, dir } = state.sort;
    const val = (r) => key === "ceo" ? lastName(r.names[0]) : key === "since" ? (r.since || "9999") : r[key];
    rows.sort((a, b) => {
      const A = val(a), B = val(b);
      return (typeof A === "number" ? A - B : String(A).localeCompare(String(B))) * dir;
    });
    return rows;
  }
  function renderTable() {
    const rows = visibleRecords();
    $("#tbody").innerHTML = rows.map((r) => {
      const checked = state.compare.includes(r.id);
      const tags = (r.profile ? "" : '<span class="tag pending">profile soon</span>') +
        (r.interim ? '<span class="tag">interim</span>' : "") + (r.coCeo ? '<span class="tag">co-CEOs</span>' : "");
      return `<tr data-id="${esc(r.id)}">
        <td class="col-check"><input type="checkbox" aria-label="Compare ${esc(r.ceoLabel)}" ${checked ? "checked" : ""} ${!checked && state.compare.length >= MAX_COMPARE ? "disabled" : ""}></td>
        <td class="rank">${r.rank}</td>
        <td class="ceo-name">${esc(r.ceoLabel)}${tags}</td>
        <td>${esc(r.company)}</td>
        <td class="hide-sm">${esc(r.sector)}</td>
        <td class="hide-md edu-cell">${eduSummary(r)}</td>
        <td class="hide-md since-cell">${r.since ? `${esc(fmtDate(r.since))} <span class="muted">· ${yearsSince(r.since)}</span>` : '<span class="na">-</span>'}</td>
      </tr>`;
    }).join("");
    $("#empty").hidden = rows.length > 0;
    $("#empty").textContent = anyFilter() ? "No CEOs match these filters. Try removing one." : "No CEOs match that search.";
    $("#row-count").textContent = `${rows.length} shown`;
    document.querySelectorAll(".ceo-table th[data-sort]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.sort === state.sort.key ? (state.sort.dir === 1 ? "ascending" : "descending") : "none");
    });
  }
  $("#tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    if (e.target.matches("input[type=checkbox]")) { toggleCompare(tr.dataset.id); return; }
    openProfile(tr.dataset.id);
  });
  document.querySelector(".ceo-table thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
    renderTable();
  });

  // ---------- filter dimensions (shared by filter panel + charts) ----------
  const DIMS = {
    University: { label: "University", fn: (p) => (p.education || []).map((e) => e.institution), chart: "#chart-uni" },
    Field: { label: "Field of study", fn: (p) => (p.education || []).flatMap((e) => e.field_groups || []), chart: "#chart-major" },
    Degree: { label: "Degree type", fn: (p) => (p.education || []).map((e) => e.degree_level) },
    Background: { label: "Professional background", fn: (p) => [p.background_category], chart: "#chart-bg" },
  };
  const DIM_ORDER = ["University", "Field", "Degree", "Background"];
  Object.keys(DIMS).forEach((k) => (state.filters[k] = new Set()));
  const valuesOf = (person, k) => [...new Set(DIMS[k].fn(person.p).filter(Boolean))];
  const anyFilter = () => DIM_ORDER.some((k) => state.filters[k].size);
  // Within a group = OR (Stanford or Harvard); across groups = AND (Stanford AND Engineering).
  function personPasses(person) {
    return DIM_ORDER.every((k) => {
      const sel = state.filters[k];
      return !sel.size || valuesOf(person, k).some((v) => sel.has(v));
    });
  }
  // a company row shows if any of its CEOs matches
  const passesFilters = (r) => r.profiles.some((p) => personPasses({ rec: r, p }));
  function toggleFilter(kind, value) {
    const sel = state.filters[kind];
    sel.has(value) ? sel.delete(value) : sel.add(value);
    refresh();
  }
  function clearFilters() { DIM_ORDER.forEach((k) => state.filters[k].clear()); refresh(); }

  // ---------- filter panel (sidebar) ----------
  const SHOW_TOP = 6;
  const expanded = {};
  function renderFilterPanel() {
    const html = DIM_ORDER.map((k) => {
      const counts = new Map();
      people.forEach((x) => valuesOf(x, k).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
      let items = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const sel = state.filters[k];
      const total = items.length;
      if (!expanded[k] && total > SHOW_TOP) items = items.filter(([v], i) => i < SHOW_TOP || sel.has(v));
      const open = sel.size || expanded[k] || k === "University" ? " open" : "";
      return `<details class="fgroup"${open} data-kind="${k}">
        <summary>${esc(DIMS[k].label)}${sel.size ? ` <span class="fcount">${sel.size}</span>` : ""}</summary>
        <div class="fopts">${items.length ? items.map(([v, n]) => `
          <label class="fopt"><input type="checkbox" data-kind="${k}" data-value="${esc(v)}" ${sel.has(v) ? "checked" : ""}>
            <span class="fname">${esc(v)}</span><span class="fn">${n}</span></label>`).join("") : '<p class="hint">No data yet.</p>'}
          ${total > SHOW_TOP ? `<button class="linkbtn" data-more="${k}">${expanded[k] ? "Show fewer" : `Show all ${total}`}</button>` : ""}
        </div></details>`;
    }).join("");
    const box = $("#filter-groups");
    const openState = {};
    box.querySelectorAll("details").forEach((d) => (openState[d.dataset.kind] = d.open));
    box.innerHTML = html;
    box.querySelectorAll("details").forEach((d) => { if (d.dataset.kind in openState && !state.filters[d.dataset.kind].size) d.open = openState[d.dataset.kind]; });
    $("#filter-clear").disabled = !anyFilter();
    $("#filter-note").textContent = `Counts are CEOs (${people.length}, including co-CEOs). University and field count each CEO once.`;
  }
  $("#filter-groups").addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-kind]");
    if (cb) toggleFilter(cb.dataset.kind, cb.dataset.value);
  });
  $("#filter-groups").addEventListener("click", (e) => {
    const b = e.target.closest("[data-more]");
    if (!b) return;
    expanded[b.dataset.more] = !expanded[b.dataset.more];
    renderFilterPanel();
  });
  $("#filter-clear").addEventListener("click", clearFilters);

  // ---------- active filter chips (above table) ----------
  function renderActiveFilters() {
    const box = $("#active-filter");
    const chips = [];
    DIM_ORDER.forEach((k) => state.filters[k].forEach((v) =>
      chips.push(`<span class="fchip">${esc(DIMS[k].label)}: <b>${esc(v)}</b><button data-kind="${k}" data-value="${esc(v)}" aria-label="Remove ${esc(v)}">×</button></span>`)));
    box.hidden = !chips.length;
    box.innerHTML = chips.join("") + (chips.length > 1 ? '<button class="linkbtn" data-clear-all>Clear all</button>' : "");
  }
  $("#active-filter").addEventListener("click", (e) => {
    if (e.target.closest("[data-clear-all]")) { clearFilters(); return; }
    const b = e.target.closest("button[data-kind]");
    if (b) toggleFilter(b.dataset.kind, b.dataset.value);
  });

  // ---------- trend charts (reflect the current filters) ----------
  const tip = $("#tooltip");
  function renderCharts() {
    const pool = people.filter(personPasses);
    DIM_ORDER.filter((k) => DIMS[k].chart).forEach((k) => {
      const m = new Map();
      pool.forEach((x) => valuesOf(x, k).forEach((v) => { if (!m.has(v)) m.set(v, []); m.get(v).push(x); }));
      const groups = [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 8);
      const el = $(DIMS[k].chart);
      if (!groups.length) { el.innerHTML = '<p class="na">No CEOs match these filters.</p>'; return; }
      const max = Math.max(...groups.map((g) => g[1].length));
      el.innerHTML = groups.map(([label, rs]) => `<button class="bar-row${state.filters[k].has(label) ? " on" : ""}" data-kind="${k}" data-value="${esc(label)}" data-names="${esc(rs.map((x) => x.name).join(", "))}" aria-pressed="${state.filters[k].has(label)}" aria-label="${esc(label)}: ${rs.length} CEO${rs.length > 1 ? "s" : ""}">
          <span class="bar-label">${esc(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="display:block;width:${(rs.length / max) * 100}%"></span></span>
          <span class="bar-val">${rs.length}</span></button>`).join("");
    });
    $("#trends-note").textContent = anyFilter()
      ? `Showing ${pool.length} CEO${pool.length === 1 ? "" : "s"} matching your filters (of ${people.length}).`
      : `All ${people.length} CEOs of the top 100 companies (co-CEOs counted individually). Top 8 shown per chart.`;
  }
  document.querySelector(".chart-grid").addEventListener("click", (e) => {
    const b = e.target.closest(".bar-row");
    if (b) toggleFilter(b.dataset.kind, b.dataset.value);
  });
  document.querySelector(".chart-grid").addEventListener("mousemove", (e) => {
    const b = e.target.closest(".bar-row");
    if (!b) { tip.hidden = true; return; }
    tip.textContent = `${b.dataset.value}: ${b.dataset.names}`;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 280) + "px";
    tip.style.top = e.clientY + 14 + "px";
  });
  document.querySelector(".chart-grid").addEventListener("mouseleave", () => (tip.hidden = true));

  function refresh() {
    renderFilterPanel();
    renderActiveFilters();
    renderTable();
    renderCharts();
  }

  // ---------- profile (mini-page) ----------
  function profileHTML(r, compact) {
    const multi = r.profiles.length > 1;
    const tags = [`<span class="tag">#${r.rank} Fortune 500</span>`, `<span class="tag">${esc(r.sector)}</span>`];
    if (!multi && r.profile) tags.push(`<span class="tag live">${esc(r.profile.background_category)}</span>`);
    if (r.interim) tags.push('<span class="tag">Interim</span>');
    let html = `<div class="profile-head">
      <div class="kicker">${esc(r.company)}</div>
      <h3 id="${compact ? "" : "drawer-title"}">${esc(r.ceoLabel)}</h3>
      <p class="role">${multi ? "Co-CEOs" : esc((r.profile && r.profile.role) || "CEO")}${!multi && r.since ? ` since ${esc(fmtDate(r.since))} · ${yearsSince(r.since)} in role` : ""}</p>
      <div class="meta-row">${tags.join("")}</div></div>`;

    if (!compact) {
      const inCompare = state.compare.includes(r.id);
      html += `<div class="drawer-actions"><button class="btn ${inCompare ? "ghost" : "primary"}" data-compare="${esc(r.id)}" ${!inCompare && state.compare.length >= MAX_COMPARE ? "disabled" : ""}>${inCompare ? "Remove from compare" : "Add to compare"}</button></div>`;
    }

    if (!r.profiles.length) {
      html += `<div class="block"><p class="na">Full profile coming soon.</p>${r.notes ? `<p class="small muted">${esc(r.notes)}</p>` : ""}
        <p class="small">${r.sources.map(src).join(" ")}</p></div>`;
      return html;
    }
    if (multi && !compact) html += `<nav class="co-nav">${r.profiles.map((p, i) => `<a href="#" data-jump="${i}">${esc(p.name)}</a>`).join("")}</nav>`;
    return html + r.profiles.map((p, i) => personHTML(p, compact, multi, i)).join("");
  }

  function personHTML(p, compact, multi, i) {
    let html = multi ? `<section class="person" data-person="${i}"><h3 class="person-name">${esc(p.name)}</h3>
      <p class="role">${esc(p.role || "Co-CEO")}${p.tenure && p.tenure.start ? ` since ${esc(fmtDate(p.tenure.start))} · ${yearsSince(p.tenure.start)} in role` : ""} <span class="tag live">${esc(p.background_category)}</span></p>` : "";
    const s = p.personal_story;
    if (s) {
      html += `<p class="hook">${esc(s.hook)}</p>
        <div class="block"><h4>The story</h4><p>${esc(s.summary)}</p>
        ${s.facts && s.facts.length ? `<div class="facts">${s.facts.map((f) => `<div class="fact"><b>${esc(f.label)}</b>${esc(f.value)} ${src(f.source)}</div>`).join("")}</div>` : ""}
        ${s.quote ? `<p class="quote">${esc(s.quote.text)}”</p><p class="quote-cite">${esc(s.quote.context)} ${src(s.quote.source)}</p>` : ""}
        ${s.depth === "limited" ? '<p class="small muted">Limited public information is available about this CEO\'s early life.</p>' : ""}</div>`;
    }

    html += `<div class="block"><h4>Education</h4>${p.education && p.education.length
      ? `<ul class="edu-list">${p.education.map((e) => `<li><b>${esc(e.institution)}</b><br><span class="muted">${esc([e.degree, e.field].filter(Boolean).join(", "))}${e.year ? ` · ${e.year}` : ""}</span> ${src(e.source)}${e.note ? `<br><span class="small na">${esc(e.note)}</span>` : ""}</li>`).join("")}</ul>`
      : '<p class="na">Not publicly available.</p>'}</div>`;

    html += `<div class="block"><h4>Career path</h4><ul class="timeline">${(p.career || []).map((c) =>
      `<li class="${c.end ? "" : "current"}"><div class="when">${esc(c.start || "?")}–${esc(c.end || "present")}</div><div class="what">${esc(c.title)}</div><div class="org">${esc(c.organization)} ${src(c.source)}</div></li>`).join("")}</ul></div>`;

    html += `<div class="block"><h4>Notable decisions &amp; statements</h4><ul class="notable">${(p.notable || []).map((n) =>
      `<li><div class="date">${esc(fmtDate(n.date))}</div><div><div class="type">${esc(n.type)}</div>${esc(n.summary)} ${src(n.source)}</div></li>`).join("")}</ul></div>`;

    if (!compact) {
      const all = new Set([...(s ? s.sources || [] : []), ...(p.education || []).map((e) => e.source), ...(p.career || []).map((c) => c.source),
        ...(p.notable || []).map((n) => n.source), p.tenure && p.tenure.source].filter(Boolean));
      html += `<div class="block"><details class="sources"><summary>All ${all.size} sources · last reviewed ${esc(p.last_reviewed)}</summary><ol>${[...all].map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join("")}</ol></details></div>`;
    }
    return multi ? html + "</section>" : html;
  }

  let lastFocus = null;
  function openProfile(id, fromHash) {
    const r = byId[id];
    if (!r) return;
    lastFocus = document.activeElement;
    $("#drawer-body").innerHTML = profileHTML(r, false);
    $("#drawer").hidden = false;
    $("#overlay").hidden = false;
    $("#drawer").scrollTop = 0;
    $("#drawer-close").focus();
    if (!fromHash) history.replaceState(null, "", "#ceo/" + id);
  }
  function closeProfile() {
    $("#drawer").hidden = true;
    $("#overlay").hidden = true;
    history.replaceState(null, "", location.pathname + location.search);
    if (lastFocus) lastFocus.focus();
  }
  $("#drawer-close").addEventListener("click", closeProfile);
  $("#overlay").addEventListener("click", closeProfile);
  $("#drawer").addEventListener("click", (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) { e.preventDefault(); const t = $("#drawer").querySelector(`[data-person="${j.dataset.jump}"]`); if (t) t.scrollIntoView({ behavior: "smooth" }); return; }
    const b = e.target.closest("[data-compare]");
    if (!b) return;
    toggleCompare(b.dataset.compare);
    openProfile(b.dataset.compare, true);
  });

  // ---------- compare ----------
  function toggleCompare(id) {
    const i = state.compare.indexOf(id);
    if (i >= 0) state.compare.splice(i, 1);
    else if (state.compare.length < MAX_COMPARE) state.compare.push(id);
    renderCompareTray();
    renderTable();
  }
  function renderCompareTray() {
    const n = state.compare.length;
    $("#compare-count").textContent = `(${n}/${MAX_COMPARE})`;
    $("#compare-chips").innerHTML = n
      ? state.compare.map((id) => `<span class="chip">${esc(byId[id].names[0])}<button data-remove="${esc(id)}" aria-label="Remove ${esc(byId[id].names[0])}">×</button></span>`).join("")
      : '<p class="hint">Tick up to 4 CEOs in the table, or use “Add to compare” on a profile.</p>';
    $("#compare-open").disabled = n < 2;
    $("#compare-clear").disabled = n === 0;
  }
  $("#compare-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (b) toggleCompare(b.dataset.remove);
  });
  $("#compare-clear").addEventListener("click", () => { state.compare = []; renderCompareTray(); renderTable(); });
  function openCompare(fromHash) {
    if (state.compare.length < 2) return;
    $("#compare-grid").innerHTML = state.compare.map((id) => `<article class="compare-col">${profileHTML(byId[id], true)}</article>`).join("");
    $("#compare-view").hidden = false;
    document.body.style.overflow = "hidden";
    $("#compare-close").focus();
    if (!fromHash) history.replaceState(null, "", "#compare/" + state.compare.join(","));
  }
  function closeCompare() {
    $("#compare-view").hidden = true;
    document.body.style.overflow = "";
    history.replaceState(null, "", location.pathname + location.search);
  }
  $("#compare-open").addEventListener("click", () => { closeProfile(); openCompare(); });
  $("#compare-close").addEventListener("click", closeCompare);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#compare-view").hidden) closeCompare();
    else if (!$("#drawer").hidden) closeProfile();
  });

  // ---------- shareable links: #ceo/<id>, #compare/<id,id> ----------
  function fromHash() {
    const [kind, arg] = location.hash.slice(1).split("/");
    if (kind === "ceo" && byId[arg]) openProfile(arg, true);
    if (kind === "compare" && arg) {
      state.compare = arg.split(",").filter((id) => byId[id]).slice(0, MAX_COMPARE);
      renderCompareTray();
      renderTable();
      openCompare(true);
    }
  }

  window.addEventListener("hashchange", fromHash);

  // ---------- go ----------
  renderTabs();
  refresh();
  renderCompareTray();
  fromHash();
})();
