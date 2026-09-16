import type { CountersignPolicy } from "../countersign/server/types.js";
import type { DraftMetadata } from "../countersign/server/policy-store.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const styles = `
  :root { color-scheme: light; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  body { margin: 0; background: #f3f0e8; color: #17211b; }
  header { padding: 1.25rem 2rem; background: #17211b; color: #f8f4e8; }
  header a { color: #d7c783; }
  main { padding: 1.5rem 2rem; }
  table { width: 100%; border-collapse: collapse; background: white; }
  th, td { padding: .65rem; border: 1px solid #c7c9c4; text-align: left; vertical-align: top; }
  th { background: #e4e0d4; }
  .human-verified { border-left: .4rem solid #28784b; }
  .automation-suspected { border-left: .4rem solid #b86b1b; }
  .agent-declared { border-left: .4rem solid #395f8a; }
  .unverified { border-left: .4rem solid #777; }
  .policy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  pre { overflow: auto; padding: 1rem; background: #fff; border: 1px solid #c7c9c4; }
  button { padding: .6rem .9rem; margin: .3rem .5rem .3rem 0; cursor: pointer; }
  button:disabled { cursor: default; opacity: .55; }
  .notice { padding: .8rem; border-left: .35rem solid #b86b1b; background: #fff5d9; }
  .policy-rule { border-top: 1px solid #c7c9c4; margin-top: 1.5rem; }
  .policy-rule pre { max-height: 30rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 800px) { .policy-grid { grid-template-columns: 1fr; } main { padding: 1rem; } }
`;

export function renderDashboard(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Countersign timeline</title>
  <style>${styles}</style>
</head>
<body>
  <header>
    <strong>Countersign provenance timeline</strong>
    &middot; <a href="/countersign/policy/review">Policy review</a>
    &middot; <a href="/quiz/1">Portal</a>
  </header>
  <main>
    <p>Polling <code>/countersign/events</code> once per second. Newest events appear last.</p>
    <table>
      <thead><tr><th>Time</th><th>User</th><th>Route / action</th><th>Rule</th><th>Decision</th><th>Actor</th></tr></thead>
      <tbody id="events"><tr><td colspan="6">Waiting for events...</td></tr></tbody>
    </table>
  </main>
  <script>
    const body = document.querySelector("#events");

    function cell(row, value) {
      const td = document.createElement("td");
      td.textContent = value == null ? "" : String(value);
      row.append(td);
    }

    async function refresh() {
      try {
        const response = await fetch("/countersign/events", { cache: "no-store" });
        const payload = await response.json();
        body.replaceChildren();
        if (payload.events.length === 0) {
          const row = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 6;
          td.textContent = "No governed events yet.";
          row.append(td);
          body.append(row);
          return;
        }
        for (const event of payload.events) {
          const row = document.createElement("tr");
          row.className = event.actor_class;
          cell(row, event.ts);
          cell(row, event.user && event.user.name);
          cell(row, event.route + " / " + event.action);
          cell(row, event.rule_id);
          cell(row, event.decision);
          cell(row, event.actor_class);
          body.append(row);
        }
      } catch (error) {
        body.textContent = "Timeline unavailable: " + error.message;
      }
    }

    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

export function renderPolicyReview(
  active: CountersignPolicy,
  draft: CountersignPolicy | null,
  options: {
    enabled: boolean; signedIn: boolean; model: string; draftError: string;
    activeRevision: string; draftRevision: string; metadata: DraftMetadata | null;
    vocabulary: { categories: number; ldcs: number; placeholder: boolean };
  },
): string {
  const activeJson = escapeHtml(JSON.stringify(active, null, 2));
  const draftJson = draft
    ? escapeHtml(JSON.stringify(draft, null, 2))
    : "No draft policy exists.";
  const mayManage = options.enabled && options.signedIn;
  const disabled = !mayManage || !draft ? "disabled" : "";
  const cards = (draft?.rules ?? []).map((rule) => {
    const current = active.rules.find((item) => item.id === rule.id);
    const changed = JSON.stringify(current) !== JSON.stringify(rule);
    return `<section class="policy-rule" data-rule="${escapeHtml(rule.id)}">
      <h2>${escapeHtml(rule.id)} — ${changed ? "proposed change" : "unchanged"}</h2>
      <p>${escapeHtml(rule.rationale)}</p>
      <label><input type="checkbox" name="rule_ids" value="${escapeHtml(rule.id)}" ${disabled}> Select this rule</label>
      <button type="button" data-approve-rule="${escapeHtml(rule.id)}" ${disabled}>Approve this rule</button>
      <div class="policy-grid">
        <section><h3>Active rule</h3><pre>${escapeHtml(current ? JSON.stringify(current, null, 2) : "Not active")}</pre></section>
        <section><h3>Draft rule (including citations)</h3><pre>${escapeHtml(JSON.stringify(rule, null, 2))}</pre></section>
      </div>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Countersign policy review</title>
  <style>${styles}</style>
</head>
<body>
  <header>
    <strong>Policy review</strong>
    &middot; <a href="/countersign/">Timeline</a>
  </header>
  <main>
    <p>Model: <strong>${escapeHtml(options.model)}</strong>. Source pages are crawled from the configured local ungoverned portal.</p>
    <p>Vocabulary: ${options.vocabulary.categories} categories, ${options.vocabulary.ldcs} limited-dissemination controls.</p>
    ${options.vocabulary.placeholder ? '<p class="notice">Scaffold vocabulary only — these identifiers and definitions are not authoritative Registry data. Import the hackathon dataset before claiming Registry-backed generation.</p>' : ""}
    ${!options.enabled ? '<p class="notice">Policy management is available on <a href="http://localhost:3000/countersign/policy/review">the governed instance</a>.</p>' : !options.signedIn ? '<p class="notice"><a href="/login">Sign in</a> to generate or approve a policy.</p>' : ""}
    <button type="button" id="generate" ${mayManage ? "" : "disabled"}>Generate draft</button>
    <p role="status" id="policy-status">${escapeHtml(options.draftError || "Generation writes a draft only. Review before approval.")}</p>
    ${options.metadata ? `<details><summary>Generation provenance</summary><pre>${escapeHtml(JSON.stringify(options.metadata, null, 2))}</pre></details>` : ""}
    <section id="approval" data-active-revision="${options.activeRevision}" data-draft-revision="${options.draftRevision}">
      <p>Per-rule approval preserves active defaults and unselected rules. Approve all replaces the complete policy. Changes take effect on the next request without restarting.</p>
      <button type="button" id="approve-selected" ${disabled}>Approve selected</button>
      <button type="button" id="approve-all" ${disabled}>Approve all</button>
      ${cards || `<p>${escapeHtml(options.draftError ? "The invalid draft cannot be approved. Generate a new draft." : "No draft policy exists.")}</p>`}
    </section>
    <details><summary>Complete active / draft JSON</summary><div class="policy-grid">
      <section><h2>Active — ${escapeHtml(active.version)}</h2><pre>${activeJson}</pre></section>
      <section><h2>Draft</h2><pre>${draftJson}</pre></section>
    </div></details>
  </main>
  <script>
    const status = document.querySelector("#policy-status");
    const approval = document.querySelector("#approval");
    const buttons = [...document.querySelectorAll("button")];
    let busy = false;
    async function submit(path, body) {
      if (busy) return;
      busy = true;
      const disabled = buttons.map(button => button.disabled);
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = path.endsWith("generate") ? "Crawling pages and asking the configured model for a draft…" : "Applying approved policy…";
      try {
        const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Policy request failed.");
        location.reload();
      } catch (error) {
        status.textContent = error.message;
        buttons.forEach((button, index) => { button.disabled = disabled[index]; });
        busy = false;
      }
    }
    function approve(selection) {
      return submit("/countersign/policy/approve", { ...selection,
        active_revision: approval.dataset.activeRevision, draft_revision: approval.dataset.draftRevision });
    }
    document.querySelector("#generate").addEventListener("click", () => submit("/countersign/policy/generate", {}));
    document.querySelector("#approve-all").addEventListener("click", () => approve({ all: true }));
    document.querySelector("#approve-selected").addEventListener("click", () => {
      const ids = [...document.querySelectorAll('input[name="rule_ids"]:checked')].map(input => input.value);
      if (!ids.length) { status.textContent = "Select at least one rule."; return; }
      approve({ rule_ids: ids });
    });
    for (const button of document.querySelectorAll("[data-approve-rule]")) {
      button.addEventListener("click", () => approve({ rule_ids: [button.dataset.approveRule] }));
    }
  </script>
</body>
</html>`;
}
