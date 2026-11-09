/* CV Studio – single-page frontend (no build step). */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $("#view");

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { "Content-Type": "application/json" };
    init.method = opts.method || "POST";
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = data && data.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : res.statusText;
    throw new Error(msg);
  }
  return data;
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 9000 : 4000);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) + ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function ymd(v) {
  if (!v) return "today";
  const m = String(v).match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[2].padStart(2, "0")}/${m[1]}` : String(v);
}

const ICON = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
};

function fileIcon(meta) {
  if (meta.url) return '<div class="file-icon fi-url">URL</div>';
  const ext = (meta.name.split(".").pop() || "").toLowerCase();
  const cls = { pdf: "fi-pdf", docx: "fi-docx", zip: "fi-zip" }[ext] || "fi-txt";
  return `<div class="file-icon ${cls}">${esc(ext.slice(0, 4).toUpperCase())}</div>`;
}

const KIND_LABEL = { cv: "CV", linkedin: "LinkedIn", xing: "XING", other: "Document" };

// ------------------------------------------------------------------ modal + task progress
function modal(html, { wide = false, onClose } = {}) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal ${wide ? "wide" : ""}">${html}</div>`;
  const close = () => { ov.remove(); onClose && onClose(); };
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
  $$("[data-close]", ov).forEach(b => b.addEventListener("click", close));
  document.body.appendChild(ov);
  return { el: ov, close };
}

function runTask(taskId, title) {
  return new Promise((resolve, reject) => {
    const m = modal(`<h2 style="text-align:center">${esc(title)}</h2><div class="spinner"></div>
      <div class="progress-step" id="ps">Starting…</div><div class="progress-time" id="pt"></div>
      <p class="muted small" style="text-align:center;margin-top:16px">This usually takes 30 seconds to 3 minutes. You can keep this tab open.</p>`);
    const t0 = Date.now();
    const timer = setInterval(async () => {
      $("#pt", m.el).textContent = `${Math.round((Date.now() - t0) / 1000)} s`;
    }, 1000);
    const poll = async () => {
      try {
        const t = await api(`/api/tasks/${taskId}`);
        $("#ps", m.el).textContent = t.step;
        if (t.status === "done") { clearInterval(timer); m.close(); resolve(t.result); return; }
        if (t.status === "error") { clearInterval(timer); m.close(); reject(new Error(t.error)); return; }
      } catch (e) { clearInterval(timer); m.close(); reject(e); return; }
      setTimeout(poll, 1500);
    };
    poll();
  });
}

// ------------------------------------------------------------------ state + router
let STATE = null;

async function refreshState() {
  STATE = await api("/api/state");
  const s = STATE;
  $("#sidebar-status").innerHTML =
    `<div><span class="dot ${s.api_key ? "ok" : ""}"></span>${s.api_key ? "Claude connected" : "No API key"}</div>
     <div style="margin-top:4px"><span class="dot ${s.pdf ? "ok" : ""}"></span>${s.pdf ? "PDF export ready" : "PDF export unavailable"}</div>`;
  return s;
}

const ROUTES = {
  "": renderHome, knowledge: renderKnowledge, templates: renderTemplates, new: renderNew,
  applications: renderApplications, app: renderApplication, settings: renderSettings,
};

async function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const fn = ROUTES[name] || renderHome;
  $$(".nav a").forEach(a => a.classList.toggle("active",
    a.dataset.route === (name || "home") || (name === "app" && a.dataset.route === "applications")));
  view.innerHTML = '<div class="spinner" style="margin-top:80px"></div>';
  try {
    await refreshState();
    await fn(arg ? decodeURIComponent(arg) : undefined);
  } catch (e) {
    view.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

function apiKeyBanner() {
  return STATE.api_key ? "" : `<div class="banner warn"><div class="grow"><b>Connect Claude first.</b> Add your Anthropic API key so the app can read documents and tailor CVs.</div><a class="btn btn-sm" href="#/settings">Open settings</a></div>`;
}

// ------------------------------------------------------------------ Overview
async function renderHome() {
  const s = STATE;
  const p = s.profile;
  const tplOk = s.templates > 0;
  view.innerHTML = `
    <div class="page-head"><div><h1>${p ? `Hello, ${esc(p.name.split(" ")[0])}` : "Welcome to CV Studio"}</h1>
      <p>Build your knowledge base once, then create a perfectly tailored CV for every job, using only true facts.</p></div>
      <a class="btn btn-primary btn-lg" href="#/new">${ICON.spark} New application</a></div>
    ${apiKeyBanner()}
    ${s.profile_error ? `<div class="banner bad"><div class="grow"><b>Your knowledge base has an error:</b> ${esc(s.profile_error)}</div><a class="btn btn-sm" href="#/knowledge">Fix it</a></div>` : ""}
    <div class="steps">
      <div class="card step-card ${p ? "done" : ""}">
        <div class="step-num">${p ? "✓" : "1"}</div><h3>Knowledge base</h3>
        <p>${p ? `${p.experience} positions, ${p.bullets} achievements, ${p.skills} skills from ${s.sources} source(s).`
              : "Upload your CV, LinkedIn or XING export and other documents. Claude extracts the facts."}</p>
        <a class="btn" href="#/knowledge">${p ? "Review & extend" : "Add sources"}</a>
      </div>
      <div class="card step-card ${tplOk ? "done" : ""}">
        <div class="step-num">${tplOk ? "✓" : "2"}</div><h3>Design template</h3>
        <p>Upload your current CV in Word. It becomes a template that keeps your exact design. ${s.templates} template(s) available.</p>
        <a class="btn" href="#/templates">Manage templates</a>
      </div>
      <div class="card step-card">
        <div class="step-num">3</div><h3>Tailor to a job</h3>
        <p>Paste a job link. You get a tailored Word + PDF CV and a match report with your gaps.</p>
        <a class="btn btn-primary" href="#/new">Create CV</a>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <div class="card-head"><h2>Recent applications</h2><a href="#/applications" class="small">View all</a></div>
      ${s.applications.length ? appTable(s.applications) : `<div class="empty">${ICON.doc}<div>No applications yet.</div></div>`}
    </div>`;
  bindAppTable();
}

function appTable(apps) {
  return `<table class="apps"><thead><tr><th>Position</th><th>Company</th><th>Match</th><th>Created</th></tr></thead><tbody>
    ${apps.map(a => `<tr class="click" data-app="${esc(a.id)}"><td><b>${esc(a.job_title)}</b></td><td>${esc(a.company)}</td>
      <td>${a.total ? `<span class="chip ${a.met / a.total >= .7 ? "ok" : a.met / a.total >= .4 ? "warn" : "bad"}">${a.met}/${a.total} met</span>` : "–"}</td>
      <td class="muted small">${esc(fmtDate(a.created))}</td></tr>`).join("")}</tbody></table>`;
}
function bindAppTable() {
  $$("tr[data-app]").forEach(tr => tr.addEventListener("click", () => location.hash = `#/app/${encodeURIComponent(tr.dataset.app)}`));
}

// ------------------------------------------------------------------ Knowledge
async function renderKnowledge() {
  const [sources, prof] = await Promise.all([api("/api/sources"), api("/api/profile")]);
  view.innerHTML = `
    <div class="page-head"><div><h1>Knowledge base</h1>
      <p>Everything the generator may say about you. Nothing outside this knowledge base ever ends up in a CV.</p></div></div>
    ${apiKeyBanner()}
    <div class="split">
      <div class="grid">
        <div class="card">
          <div class="card-head"><h2>1. Add sources</h2></div>
          <div class="dropzone" id="dz">${ICON.upload}<b>Drop files here or click to upload</b>
            <div class="muted small">Your CV, LinkedIn / XING profile PDF or data export (.zip), references, certificates, project notes</div>
            <div class="types"><span class="chip">PDF</span><span class="chip">Word</span><span class="chip">ZIP export</span><span class="chip">TXT / MD</span></div>
          </div>
          <input type="file" id="file" multiple accept=".pdf,.docx,.zip,.txt,.md,.html,.htm,.csv,.json,.yaml,.yml" class="hidden">
          <div style="display:flex;gap:8px;margin-top:12px">
            <input type="url" id="srcurl" placeholder="…or a web page, e.g. your personal website / portfolio">
            <button class="btn" id="addurl">${ICON.link} Add</button>
          </div>
          <p class="hint">LinkedIn: open your profile → <b>More → Save to PDF</b>, or Settings → Data privacy → <b>Get a copy of your data</b> (ZIP).<br>
            XING: profile → <b>… → Save as PDF</b>.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>2. Build knowledge</h2><label class="toggle small"><input type="checkbox" id="selall" checked> all</label></div>
          ${sources.length ? `<div class="list">${sources.map(s => `
            <div class="list-item">
              <input type="checkbox" class="srcsel" value="${esc(s.id)}" checked style="width:18px;height:18px;accent-color:var(--accent)">
              ${fileIcon(s)}
              <div class="grow"><div class="title" title="${esc(s.name)}">${esc(s.name)}</div>
                <div class="muted small" style="display:flex;gap:8px;align-items:center;margin-top:2px">
                  <select class="kindsel" data-kind="${esc(s.id)}" title="What is this document?">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${k === s.kind ? "selected" : ""}>${l}</option>`).join("")}</select>
                  <span>${s.chars.toLocaleString()} characters</span></div></div>
              <button class="btn btn-sm btn-ghost" data-view="${esc(s.id)}" title="Show extracted text">${ICON.eye}</button>
              <button class="btn btn-sm btn-ghost btn-danger" data-del="${esc(s.id)}" title="Remove">${ICON.trash}</button>
            </div>`).join("")}</div>
            <button class="btn btn-primary" id="build" style="margin-top:14px;width:100%">${ICON.spark} ${prof.profile ? "Update knowledge base from selected sources" : "Build knowledge base"}</button>
            <p class="hint">Claude reads the selected sources and proposes changes. You review every change before it is saved.</p>`
          : `<div class="empty">${ICON.doc}<div>No sources yet. Start with your current CV.</div></div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Your knowledge base</h2>
          ${prof.yaml ? `<div class="segmented" style="margin:0"><button class="active" data-tab="overview">Overview</button><button data-tab="edit">Edit</button></div>` : ""}</div>
        <div id="kb-overview">${prof.profile ? knowledgeOverview(prof.profile) : `<div class="empty">${ICON.doc}<div>Empty. Add sources on the left and click <b>Build knowledge base</b>.</div></div>`}</div>
        <div id="kb-edit" class="hidden">
          <p class="hint" style="margin-top:0">Edit your facts directly (YAML). Tip: add achievements with numbers; link bullets to skills; add <code>aliases</code> only for true synonyms. A backup is kept on every save.</p>
          <textarea class="code" id="yaml" spellcheck="false">${esc(prof.yaml)}</textarea>
          <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary" id="saveyaml">Save changes</button><button class="btn" id="cancelyaml">Cancel</button></div>
        </div>
      </div>
    </div>`;

  // uploads
  const dz = $("#dz"), fi = $("#file");
  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag"); uploadSources(e.dataTransfer.files); });
  fi.addEventListener("change", () => uploadSources(fi.files));
  $("#addurl").addEventListener("click", async () => {
    const url = $("#srcurl").value.trim();
    if (!url) return;
    try { await api("/api/sources/url", { json: { url } }); toast("Page added", "ok"); route(); }
    catch (e) { toast(e.message, "error"); }
  });
  $$("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Remove this source? (Your knowledge base is not changed.)")) return;
    await api(`/api/sources/${b.dataset.del}`, { method: "DELETE" }); route();
  }));
  $$("[data-kind]").forEach(sel => sel.addEventListener("change", async () => {
    try { await api(`/api/sources/${sel.dataset.kind}`, { method: "PATCH", json: { kind: sel.value } }); toast("Saved", "ok"); }
    catch (e) { toast(e.message, "error"); }
  }));
  $$("[data-view]").forEach(b => b.addEventListener("click", async () => {
    const t = await api(`/api/sources/${b.dataset.view}/text`);
    modal(`<div class="card-head"><h2>Extracted text</h2><button class="btn btn-sm" data-close>Close</button></div>
      <pre class="source-text">${esc(t.text)}</pre><p class="hint">PDFs are additionally sent to Claude as the original file, so layout and columns are understood.</p>`, { wide: true });
  }));
  const selall = $("#selall");
  if (selall) selall.addEventListener("change", () => $$(".srcsel").forEach(c => c.checked = selall.checked));
  const build = $("#build");
  if (build) build.addEventListener("click", async () => {
    const ids = $$(".srcsel").filter(c => c.checked).map(c => c.value);
    if (!ids.length) return toast("Select at least one source.", "error");
    try {
      const { task_id } = await api("/api/knowledge/build", { json: { source_ids: ids } });
      const res = await runTask(task_id, "Building your knowledge base");
      showProposal(res.proposal_id);
    } catch (e) { toast(e.message, "error"); }
  });

  // editor
  $$("[data-tab]").forEach(b => b.addEventListener("click", () => {
    $$("[data-tab]").forEach(x => x.classList.toggle("active", x === b));
    $("#kb-overview").classList.toggle("hidden", b.dataset.tab !== "overview");
    $("#kb-edit").classList.toggle("hidden", b.dataset.tab !== "edit");
  }));
  const save = $("#saveyaml");
  if (save) {
    save.addEventListener("click", async () => {
      try { await api("/api/profile", { method: "PUT", json: { yaml: $("#yaml").value } }); toast("Knowledge base saved", "ok"); route(); }
      catch (e) { toast(e.message, "error"); }
    });
    $("#cancelyaml").addEventListener("click", route);
  }
}

async function uploadSources(files) {
  if (!files || !files.length) return;
  const fd = new FormData();
  [...files].forEach(f => fd.append("files", f));
  try {
    const res = await api("/api/sources", { method: "POST", body: fd });
    res.errors.forEach(e => toast(e, "error"));
    if (res.added.length) toast(`${res.added.length} source(s) added`, "ok");
    route();
  } catch (e) { toast(e.message, "error"); }
}

function knowledgeOverview(p) {
  const per = p.personal || {};
  const groups = {};
  (p.skills || []).forEach(s => (groups[s.category] = groups[s.category] || []).push(s));
  return `
    <div style="display:flex;gap:16px;align-items:center">
      <div class="brand-logo" style="width:52px;height:52px;font-size:18px;border-radius:50%;flex:none">${esc((per.name || "?").split(" ").map(x => x[0]).slice(0, 2).join(""))}</div>
      <div><div style="font-weight:700;font-size:17px">${esc(per.name)}</div>
        <div class="muted small">${esc([per.location, per.email, per.phone].filter(Boolean).join(" · "))}</div>
        <div class="chips" style="margin-top:6px">${(p.headlines || []).map(h => `<span class="chip accent">${esc(h)}</span>`).join("")}</div></div>
    </div>
    <div class="stat-row" style="margin-top:18px">
      ${[["Positions", p.experience.length], ["Achievements", p.experience.reduce((n, e) => n + e.bullets.length, 0)], ["Skills", p.skills.length],
         ["Education", p.education.length], ["Projects", p.projects.length], ["Publications", (p.publications || []).length], ["Languages", p.languages.length]]
        .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("")}
    </div>
    <div class="section-label">Experience</div>
    <div class="timeline">${p.experience.map(e => `
      <div class="tl-item"><div class="when">${esc(ymd(e.start))} – ${esc(e.end ? ymd(e.end) : (p.settings?.present_label || "today"))}</div>
        <div class="what">${esc(e.title)} <span class="muted" style="font-weight:400">· ${esc(e.company)}</span></div>
        ${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b.text)}</li>`).join("")}</ul>`
          : `<div class="small" style="color:var(--warn)">No achievements yet. Add some to strengthen this role.</div>`}
      </div>`).join("")}</div>
    <div class="section-label">Education</div>
    <div class="timeline">${p.education.map(e => `<div class="tl-item"><div class="when">${esc(e.start ? ymd(e.start) + " – " : "")}${esc(e.end ? ymd(e.end) : "")}</div>
      <div class="what">${esc(e.degree)} <span class="muted" style="font-weight:400">· ${esc(e.institution)}</span></div></div>`).join("")}</div>
    <div class="section-label">Skills</div>
    ${Object.entries(groups).map(([cat, items]) => `<div style="margin-bottom:10px"><div class="small" style="font-weight:600;margin-bottom:4px">${esc(cat)}</div>
      <div class="chips">${items.map(s => `<span class="chip" title="${esc((s.aliases || []).join(", "))}">${esc(s.name)}${s.level ? ` · ${esc(s.level)}` : ""}</span>`).join("")}</div></div>`).join("")}
    <div class="section-label">Languages</div>
    <div class="chips">${p.languages.map(l => `<span class="chip">${esc(l.name)} · ${esc(l.level)}</span>`).join("")}</div>`;
}

async function showProposal(pid) {
  const pr = await api(`/api/proposals/${pid}`);
  const r = pr.result;
  const counts = { added: 0, changed: 0, removed: 0 };
  pr.diff.forEach(d => counts[d.change]++);
  const bySection = {};
  pr.diff.forEach(d => (bySection[d.section] = bySection[d.section] || []).push(d));
  const m = modal(`
    <div class="card-head"><h2>Review proposed changes</h2><button class="btn btn-sm" data-close>Close</button></div>
    <p>${esc(r.change_summary)}</p>
    <div class="chips" style="margin-bottom:14px"><span class="chip ok">+ ${counts.added} added</span><span class="chip warn">~ ${counts.changed} changed</span><span class="chip bad">− ${counts.removed} removed</span>
      <span class="chip">from ${pr.source_names.map(esc).join(", ")}</span></div>
    ${pr.errors.length ? `<div class="banner bad"><div><b>Must be fixed before saving:</b><ul>${pr.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div></div>` : ""}
    ${pr.warnings.length ? `<div class="banner warn"><div><b>Please double-check:</b><ul>${pr.warnings.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div></div>` : ""}
    ${r.conflicts.length ? `<h3>Conflicts between sources</h3>${r.conflicts.map(c => `<div class="diff-item"><b>${esc(c.topic)}</b><div class="small">${esc(c.details)}</div><div class="small muted">Resolution: ${esc(c.resolution)}</div></div>`).join("")}` : ""}
    ${r.questions.length ? `<h3 style="margin-top:16px">Questions to strengthen your profile</h3><ul>${r.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ul><p class="hint">Answer these by editing the knowledge base after saving, or upload a short notes file as another source.</p>` : ""}
    <h3 style="margin-top:16px">Changes</h3>
    ${Object.entries(bySection).map(([sec, items]) => `<div class="section-label">${esc(sec)} (${items.length})</div>
      ${items.map(d => `<div class="diff-item"><div class="head"><span class="chip ${d.change === "added" ? "ok" : d.change === "changed" ? "warn" : "bad"}">${esc(d.change)}</span><b class="small">${esc(d.label)}</b></div>
        ${d.before ? `<div class="diff-before">${esc(d.before)}</div>` : ""}${d.after ? `<div class="diff-after">${esc(d.after)}</div>` : ""}</div>`).join("")}`).join("") || '<p class="muted">No changes.</p>'}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;position:sticky;bottom:-28px;background:#fff;padding:14px 0">
      <button class="btn" id="discard">Discard</button>
      <button class="btn btn-primary" id="apply" ${pr.errors.length ? "disabled" : ""}>Save to knowledge base</button></div>`, { wide: true });
  $("#discard", m.el).addEventListener("click", async () => { await api(`/api/proposals/${pid}`, { method: "DELETE" }); m.close(); });
  $("#apply", m.el).addEventListener("click", async () => {
    try { await api(`/api/proposals/${pid}/apply`, { method: "POST" }); m.close(); toast("Knowledge base updated", "ok"); route(); }
    catch (e) { toast(e.message, "error"); }
  });
}

// ------------------------------------------------------------------ Templates
async function renderTemplates() {
  const tpls = await api("/api/templates");
  const bust = Date.now();
  view.innerHTML = `
    <div class="page-head"><div><h1>Templates</h1><p>The design of your CV. Upload your current CV and it becomes a reusable template, keeping your fonts, colours and layout.</p></div></div>
    ${apiKeyBanner()}
    <div class="card" style="margin-bottom:20px">
      <div class="grid grid-2" style="align-items:center">
        <div class="dropzone" id="tdz">${ICON.upload}<b>Upload your CV as Word (.docx)</b>
          <div class="muted small">Claude maps your layout to placeholders. A preview is generated with your knowledge base.</div></div>
        <div><label class="field"><span>Template name (optional)</span><input type="text" id="tname" placeholder="e.g. My CV 2026"></label>
          <p class="hint">Only have a PDF? Open it in Word (File → Open converts it) and save as .docx. Already tagged templates (with <code>{{ name }}</code> placeholders) are used as they are.</p></div>
      </div>
      <input type="file" id="tfile" accept=".docx" class="hidden">
    </div>
    ${STATE.profile ? "" : '<div class="banner info">Previews are generated from your knowledge base. Build it first to see your data in the templates.</div>'}
    <div class="tpl-grid">${tpls.map(t => `
      <div class="card tpl-card">
        <div class="tpl-thumb">${t.pages ? `<img src="/api/templates/${esc(t.id)}/pages/1.png?b=${bust}" alt="Preview of ${esc(t.name)}">`
          : `<div class="nopreview">${!STATE.pdf ? "Install LibreOffice for previews" : STATE.profile ? `<div><div class="spinner" style="width:30px;height:30px;border-width:3px"></div>Generating preview…</div>` : "Preview appears once your knowledge base exists"}</div>`}</div>
        <div class="tpl-body">
          <div><b>${esc(t.name)}</b> ${t.default ? '<span class="chip ok">Default</span>' : ""}
            <div class="small muted">${esc({ "built-in": "Built-in", converted: "Converted from your CV", uploaded: "Uploaded template" }[t.origin] || t.origin)}</div></div>
          ${t.notes ? `<div class="small muted" style="max-height:60px;overflow:auto">${esc(t.notes)}</div>` : ""}
          <div class="tpl-actions">
            ${t.has_preview ? `<a class="btn btn-sm" target="_blank" href="/api/templates/${esc(t.id)}/preview.pdf?b=${bust}">${ICON.eye} Preview</a>` : ""}
            ${STATE.profile && STATE.pdf ? `<button class="btn btn-sm" data-prev="${esc(t.id)}">Refresh</button>` : ""}
            ${t.default ? "" : `<button class="btn btn-sm" data-def="${esc(t.id)}">Set default</button>`}
            <a class="btn btn-sm" href="/api/templates/${esc(t.id)}/template.docx" title="Download to fine-tune in Word">${ICON.download}</a>
            ${t.origin === "built-in" ? "" : `<button class="btn btn-sm btn-danger" data-tdel="${esc(t.id)}">${ICON.trash}</button>`}
          </div>
        </div>
      </div>`).join("")}</div>`;

  const dz = $("#tdz"), fi = $("#tfile");
  dz.addEventListener("click", () => fi.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag"); uploadTemplate(e.dataTransfer.files[0]); });
  fi.addEventListener("change", () => uploadTemplate(fi.files[0]));
  $$("[data-def]").forEach(b => b.addEventListener("click", async () => { await api(`/api/templates/${b.dataset.def}/default`, { method: "POST" }); route(); }));
  const missing = tpls.filter(t => !t.pages);
  if (missing.length && STATE.profile && STATE.pdf) {
    (async () => {
      for (const t of missing) { try { await api(`/api/templates/${t.id}/preview`, { method: "POST" }); } catch (e) { toast(`${t.name}: ${e.message}`, "error"); } }
      if (location.hash.startsWith("#/templates")) route();
    })();
  }
  $$("[data-prev]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Rendering…";
    try { await api(`/api/templates/${b.dataset.prev}/preview`, { method: "POST" }); route(); }
    catch (e) { toast(e.message, "error"); b.disabled = false; b.textContent = "Refresh"; }
  }));
  $$("[data-tdel]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Delete this template?")) return;
    await api(`/api/templates/${b.dataset.tdel}`, { method: "DELETE" }); route();
  }));
}

async function uploadTemplate(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("name", $("#tname").value.trim());
  try {
    const res = await api("/api/templates", { method: "POST", body: fd });
    if (res.task_id) await runTask(res.task_id, "Turning your CV into a template");
    toast("Template ready", "ok");
    route();
  } catch (e) { toast(e.message, "error"); }
}

// ------------------------------------------------------------------ New application
async function renderNew() {
  const tpls = await api("/api/templates");
  const def = STATE.default_template;
  view.innerHTML = `
    <div class="page-head"><div><h1>New application</h1><p>Paste the job posting. Claude analyses the company and the requirements and tailors your CV, using only facts from your knowledge base.</p></div></div>
    ${apiKeyBanner()}
    ${STATE.profile ? "" : '<div class="banner warn"><div class="grow">Your knowledge base is empty.</div><a class="btn btn-sm" href="#/knowledge">Build it first</a></div>'}
    <div class="split">
      <div class="card">
        <div class="segmented"><button class="active" data-mode="url">Job link</button><button data-mode="text">Paste text</button></div>
        <div id="mode-url"><label class="field"><span>Link to the job posting</span>
          <input type="url" id="joburl" placeholder="https://careers.company.com/jobs/12345">
          <div class="hint">LinkedIn and some portals block automatic reading. If that happens, switch to <b>Paste text</b>.</div></label></div>
        <div id="mode-text" class="hidden"><label class="field"><span>Job description</span>
          <textarea id="jobtext" rows="12" placeholder="Paste the complete job ad, ideally including the 'About us' part."></textarea></label>
          <label class="field"><span>Link (optional, for your records)</span><input type="url" id="joburl2" placeholder="https://…"></label></div>
        <label class="field"><span>Design</span><select id="tpl">${tpls.map(t => `<option value="${esc(t.id)}" ${t.id === def ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        <label class="toggle" style="margin-bottom:18px"><input type="checkbox" id="strict">
          <span><b>Strict mode</b><br><span class="muted small">Never reword: use your achievements and summary exactly as written in the knowledge base. Claude still selects and orders them.</span></span></label>
        <button class="btn btn-primary btn-lg" id="gen" style="width:100%" ${STATE.profile ? "" : "disabled"}>${ICON.spark} Generate tailored CV</button>
      </div>
      <div class="card">
        <h2>What happens</h2>
        <div class="timeline">
          <div class="tl-item"><div class="what">Read the posting</div><div class="muted small">Job title, company, tasks, must-have and nice-to-have requirements, keywords.</div></div>
          <div class="tl-item"><div class="what">Select & order your facts</div><div class="muted small">Most relevant achievements first, matching skills, fitting headline and summary, in the job's vocabulary where true.</div></div>
          <div class="tl-item"><div class="what">Fact check</div><div class="muted small">Every reworded line is checked against your knowledge base: no new numbers, tools or claims. Violations fall back to your own wording.</div></div>
          <div class="tl-item"><div class="what">Your documents</div><div class="muted small">Word + PDF in your design, plus a match report with your gaps and talking points for the cover letter.</div></div>
        </div>
      </div>
    </div>`;
  $$("[data-mode]").forEach(b => b.addEventListener("click", () => {
    $$("[data-mode]").forEach(x => x.classList.toggle("active", x === b));
    $("#mode-url").classList.toggle("hidden", b.dataset.mode !== "url");
    $("#mode-text").classList.toggle("hidden", b.dataset.mode !== "text");
  }));
  $("#gen").addEventListener("click", async () => {
    const textMode = !$("#mode-text").classList.contains("hidden");
    const body = {
      job_url: textMode ? $("#joburl2").value.trim() : $("#joburl").value.trim(),
      job_text: textMode ? $("#jobtext").value.trim() : "",
      template_id: $("#tpl").value, strict: $("#strict").checked,
    };
    if (!body.job_url && !body.job_text) return toast("Paste a job link or the job description.", "error");
    try {
      const { task_id } = await api("/api/applications", { json: body });
      const res = await runTask(task_id, "Tailoring your CV");
      location.hash = `#/app/${encodeURIComponent(res.application_id)}`;
    } catch (e) { toast(e.message, "error"); }
  });
}

// ------------------------------------------------------------------ Applications
async function renderApplications() {
  const apps = await api("/api/applications");
  view.innerHTML = `<div class="page-head"><div><h1>Applications</h1><p>Every tailored CV you created, with its match report.</p></div>
    <a class="btn btn-primary" href="#/new">${ICON.spark} New application</a></div>
    <div class="card">${apps.length ? appTable(apps) : `<div class="empty">${ICON.doc}<div>No applications yet.</div></div>`}</div>`;
  bindAppTable();
}

async function renderApplication(aid) {
  const [{ meta, detail }, tpls] = await Promise.all([api(`/api/applications/${encodeURIComponent(aid)}`), api("/api/templates")]);
  const a = detail.analysis;
  const pct = meta.total ? Math.round(100 * (meta.met + 0.5 * meta.partial) / meta.total) : 0;
  const base = `/api/applications/${encodeURIComponent(aid)}/files/`;
  const order = { missing: 0, partial: 1, met: 2 };
  const reqs = [...detail.requirements].sort((x, y) => order[y.status] - order[x.status]);
  const gaps = detail.requirements.filter(r => r.status === "missing");
  view.innerHTML = `
    <div class="page-head"><div class="result-head">
        <div class="ring" style="--p:${pct}"><div><b>${meta.met}/${meta.total}</b><span>met</span></div></div>
        <div><h1>${esc(a.job_title)}</h1><p>${esc(a.company)}${a.seniority ? ` · ${esc(a.seniority)}` : ""} · ${esc(fmtDate(meta.created))}
          ${meta.url ? ` · <a href="${esc(meta.url)}" target="_blank" rel="noopener">Job posting</a>` : ""}</p>
          ${meta.strict ? '<span class="chip">Strict mode</span>' : ""}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${meta.pdf ? `<a class="btn btn-primary" href="${base}${encodeURIComponent(meta.pdf)}" download>${ICON.download} PDF</a>` : ""}
        <a class="btn ${meta.pdf ? "" : "btn-primary"}" href="${base}${encodeURIComponent(meta.docx)}" download>${ICON.download} Word</a>
        <a class="btn" href="${base}report.md" download>${ICON.download} Report</a>
        <button class="btn btn-danger" id="delapp">${ICON.trash}</button></div></div>
    <div class="split">
      <div class="grid">
        <div class="card"><h2>About the role</h2><p style="margin-top:0">${esc(a.company_summary)}</p>
          <div class="chips">${(a.keywords || []).map(k => `<span class="chip">${esc(k)}</span>`).join("")}</div></div>
        <div class="card"><div class="card-head"><h2>Requirements</h2>
            <span class="small muted">${meta.met} met · ${meta.partial} partial · ${meta.total - meta.met - meta.partial} missing</span></div>
          <table class="req">${reqs.map(r => `<tr><td style="width:30px"><span class="status ${esc(r.status)}">${{ met: "✓", partial: "~", missing: "✕" }[r.status]}</span></td>
            <td><b>${esc(r.requirement)}</b>${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ""}
            ${r.evidence.length ? `<div class="chips" style="margin-top:4px">${r.evidence.map(e => `<span class="chip">${esc(e)}</span>`).join("")}</div>` : ""}</td></tr>`).join("")}</table>
          ${gaps.length ? `<div class="banner info" style="margin:14px 0 0"><div><b>Gaps were not added to your CV.</b> If you do have this experience, add it to your knowledge base and generate again.</div></div>` : ""}
        </div>
        ${detail.cover_letter_hooks.length ? `<div class="card"><h2>Talking points</h2><p class="small muted" style="margin-top:-6px">For your cover letter and interview.</p>
          <ul>${detail.cover_letter_hooks.map(h => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
        <div class="card"><h2>Fact check</h2>
          ${detail.warnings.length ? `<p class="small muted" style="margin-top:-6px">Automatic corrections: these suggestions went beyond your knowledge base and were reverted.</p>
            <ul class="small">${detail.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>`
          : '<p style="margin:0"><span class="chip ok">✓ All tailored content passed the fact checks</span></p>'}</div>
        <div class="card"><h2>Change design</h2><p class="small muted" style="margin-top:-6px">Same content, different template. No new AI call.</p>
          <div style="display:flex;gap:8px"><select id="retpl">${tpls.map(t => `<option value="${esc(t.id)}" ${t.id === meta.template_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
          <button class="btn" id="rerender">Apply</button></div></div>
      </div>
      <div class="pages">${meta.pages ? Array.from({ length: meta.pages }, (_, i) =>
          `<a href="${base}${encodeURIComponent(meta.pdf)}" target="_blank" title="Open PDF"><img class="page-img" src="/api/applications/${encodeURIComponent(aid)}/pages/${i + 1}.png?b=${Date.now()}" alt="Page ${i + 1}"></a>`).join("")
        : meta.pdf ? `<iframe class="pdf-frame" src="${base}${encodeURIComponent(meta.pdf)}#view=FitH"></iframe>`
        : `<div class="card"><div class="empty">${ICON.doc}<div>PDF preview needs LibreOffice. Download the Word file instead.</div></div></div>`}</div>
    </div>`;
  $("#delapp").addEventListener("click", async () => {
    if (!confirm("Delete this application and its files?")) return;
    await api(`/api/applications/${encodeURIComponent(aid)}`, { method: "DELETE" });
    location.hash = "#/applications";
  });
  $("#rerender").addEventListener("click", async () => {
    const b = $("#rerender"); b.disabled = true; b.textContent = "Rendering…";
    try { await api(`/api/applications/${encodeURIComponent(aid)}/rerender`, { json: { template_id: $("#retpl").value } }); toast("Design changed", "ok"); route(); }
    catch (e) { toast(e.message, "error"); b.disabled = false; b.textContent = "Apply"; }
  });
}

// ------------------------------------------------------------------ Settings
async function renderSettings() {
  const s = await api("/api/settings");
  const models = [["claude-opus-5-5", "Claude Opus 5.5 – best quality (recommended)"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 – faster, cheaper"], ["claude-haiku-5-5", "Claude Haiku 5.5 – fastest, cheapest"]];
  if (!models.some(m => m[0] === s.model)) models.push([s.model, s.model]);
  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Your data stays on this computer in the <code>workspace/</code> folder.</p></div></div>
    <div class="grid grid-2">
      <div class="card"><h2>Claude</h2>
        <label class="field"><span>Anthropic API key</span>
          <input type="password" id="key" placeholder="${s.api_key_set ? `Saved (${esc(s.api_key_hint)}). Enter a new key to replace it.` : "sk-ant-…"}" autocomplete="off">
          <div class="hint">${STATE.api_key_from_env ? "Currently using the key from the ANTHROPIC_API_KEY environment variable. " : ""}Get a key at console.anthropic.com. It is stored only in workspace/settings.json on this computer.</div></label>
        <label class="field"><span>Model</span><select id="model">${models.map(([v, l]) => `<option value="${esc(v)}" ${v === s.model ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <label class="field"><span>Thoroughness</span><select id="effort">${["low", "medium", "high", "xhigh", "max"].map(e => `<option ${e === s.effort ? "selected" : ""}>${e}</option>`).join("")}</select>
          <div class="hint">Higher is more careful but slower and a bit more expensive. "high" is a good default.</div></label>
        <button class="btn btn-primary" id="savesettings">Save settings</button>
      </div>
      <div class="card"><h2>System</h2>
        <div class="list">
          <div class="list-item"><div class="grow"><div class="title">Claude connection</div><div class="muted small">${STATE.api_key ? "API key configured" : "No API key yet"}</div></div><span class="chip ${STATE.api_key ? "ok" : "bad"}">${STATE.api_key ? "Ready" : "Missing"}</span></div>
          <div class="list-item"><div class="grow"><div class="title">PDF export</div><div class="muted small">${STATE.pdf ? "LibreOffice found" : "Install LibreOffice (free) to export PDFs and see previews. Word files work without it."}</div></div><span class="chip ${STATE.pdf ? "ok" : "warn"}">${STATE.pdf ? "Ready" : "Optional"}</span></div>
        </div>
      </div>
    </div>`;
  $("#savesettings").addEventListener("click", async () => {
    const body = { model: $("#model").value, effort: $("#effort").value };
    const key = $("#key").value.trim();
    if (key) body.api_key = key;
    try { await api("/api/settings", { method: "PUT", json: body }); toast("Settings saved", "ok"); route(); }
    catch (e) { toast(e.message, "error"); }
  });
}

route();
