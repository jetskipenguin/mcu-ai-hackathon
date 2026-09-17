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
  :root { color-scheme: light; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; overflow-wrap: anywhere; }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #f3f0e8; color: #17211b; }
  header { padding: 1.25rem 2rem; background: #17211b; color: #f8f4e8; }
  header a { color: #d7c783; }
  main { padding: 1.5rem 2rem; }
  table { width: 100%; border-collapse: collapse; background: white; }
  th, td { padding: .65rem; border: 1px solid #c7c9c4; text-align: left; vertical-align: top; }
  th { background: #e4e0d4; }
  .human-verified { border-left: .4rem solid #28784b; }
  .unverified { border-left: .4rem solid #777; }
  .actor-key span { display: inline-block; padding: .3rem .6rem; margin: .2rem; }
  .timeline-controls { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; }
  select { padding: .5rem; max-width: 100%; }
  .timeline-scroll { overflow-x: auto; }
  .timeline-scroll table { min-width: 64rem; }
  #events pre { max-width: 40rem; max-height: 28rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .policy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .policy-grid > section { min-width: 0; }
  pre { max-width: 100%; max-height: 30rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 1rem; background: #fff; border: 1px solid #c7c9c4; }
  button { max-width: 100%; white-space: normal; padding: .6rem .9rem; margin: .3rem .5rem .3rem 0; cursor: pointer; }
  button:disabled { cursor: default; opacity: .55; }
  .notice { padding: .8rem; border-left: .35rem solid #b86b1b; background: #fff5d9; }
  .policy-rule { border-top: 1px solid #c7c9c4; margin-top: 1.5rem; }
  @media (max-width: 800px) { .policy-grid { grid-template-columns: minmax(0, 1fr); } main, header { padding: 1rem; } }
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
    <p>Polling <code>/countersign/events</code> once per second. Events stay in append order; newest appear last.</p>
    <div class="timeline-controls">
      <label for="user-filter">Show user</label>
      <select id="user-filter"><option value="">All users</option></select>
      <button type="button" id="all-users">Show all users</button>
    </div>
    <p class="actor-key" aria-label="Actor color key">
      <span class="human-verified">human-verified</span>
      <span class="unverified">unverified</span>
    </p>
    <p>Presence verifies participation at the action, not authorship. Agent detection is disabled. Historical events retain their original labels; composition review flags are advisory.</p>
    <p id="timeline-status" role="status">Waiting for events…</p>
    <div class="timeline-scroll"><table>
      <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Route / action</th><th scope="col">Rule</th><th scope="col">Decision</th><th scope="col">Actor</th><th scope="col">Evidence</th></tr></thead>
      <tbody id="events"><tr><td colspan="7">Waiting for events…</td></tr></tbody>
    </table></div>
  </main>
  <script>
    const body = document.querySelector("#events");
    const filter = document.querySelector("#user-filter");
    const status = document.querySelector("#timeline-status");
    const actors = ["human-verified", "unverified"];
    const rows = new Map();
    let events = [];
    let selectedUser = new URL(location.href).searchParams.get("user") || "";
    let busy = false;

    function cell(row, value) {
      const td = document.createElement("td");
      td.textContent = value == null ? "" : String(value);
      row.append(td);
      return td;
    }

    function createRow(event) {
      const row = document.createElement("tr");
      row.dataset.eventId = event.event_id;
      row.className = actors.includes(event.actor_class) ? event.actor_class : "unverified";
      cell(row, event.ts);
      const user = document.createElement("a");
      user.textContent = event.user.name + " (" + event.user.id + ")";
      user.href = "?user=" + encodeURIComponent(event.user.id);
      user.addEventListener("click", e => {
        if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        selectUser(event.user.id);
        filter.focus();
      });
      cell(row, "").append(user);
      cell(row, event.route + " / " + event.action);
      cell(row, event.rule_id);
      cell(row, event.decision);
      cell(row, event.actor_class);
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Event details";
      const evidence = document.createElement("pre");
      evidence.textContent = JSON.stringify(event, null, 2);
      details.append(summary, evidence);
      cell(row, "").append(details);
      return row;
    }

    function render() {
      const users = new Map(events.map(event => [event.user.id, event.user.name]));
      if (selectedUser && !users.has(selectedUser)) users.set(selectedUser, "No events yet");
      const choices = [["", "All users"], ...[...users].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, name]) => [id, name + " (" + id + ")"])];
      // Do not replace the focused select or open evidence on each polling tick.
      const signature = JSON.stringify(choices);
      if (filter.dataset.choices !== signature) {
        filter.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
        filter.dataset.choices = signature;
      }
      filter.value = selectedUser;
      const visible = events.filter(event => !selectedUser || event.user.id === selectedUser);
      let index = 0;
      for (const event of visible) {
        let row = rows.get(event.event_id);
        if (!row) { row = createRow(event); rows.set(event.event_id, row); }
        if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
        index++;
      }
      while (body.children.length > index) body.lastElementChild.remove();
      if (!visible.length) {
        const row = document.createElement("tr");
        cell(row, selectedUser ? "No events for this user yet." : "No governed events yet.").colSpan = 7;
        body.append(row);
      }
      const ids = new Set(events.map(event => event.event_id));
      for (const id of rows.keys()) if (!ids.has(id)) rows.delete(id);
      status.textContent = "Showing " + visible.length + " of " + events.length + " events — " +
        (selectedUser ? "user " + selectedUser : "all users") + ". Updates every second.";
    }

    function selectUser(id) {
      selectedUser = id;
      const url = new URL(location.href);
      if (id) url.searchParams.set("user", id); else url.searchParams.delete("user");
      history.replaceState(null, "", url);
      render();
    }

    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/countersign/events", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const payload = await response.json();
        if (!Array.isArray(payload.events)) throw new Error("Invalid events response");
        events = payload.events;
        render();
      } catch (error) {
        status.textContent = "Timeline unavailable: " + error.message + ". Keeping the last events; retrying every second.";
      } finally { busy = false; }
    }

    filter.addEventListener("change", () => selectUser(filter.value));
    document.querySelector("#all-users").addEventListener("click", () => selectUser(""));
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
