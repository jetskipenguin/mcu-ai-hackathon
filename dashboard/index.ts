import type { CountersignPolicy } from "../countersign/server/types.js";
import type { DraftMetadata } from "../countersign/server/policy-store.js";
import { portalOrigin } from "../countersign/server/origin.js";
import { escapeHtml, renderHero, renderShell } from "../countersign/server/ui.js";

export function renderDashboard(enabled = true): string {
  const columns = [
    ["time", "Time"], ["user", "User"], ["route", "Route / action"],
    ["rule", "Rule"], ["decision", "Decision"], ["actor", "Actor"],
  ];
  const headers = columns.map(([key, label]) =>
    `<th scope="col"><button type="button" class="sort-column" data-sort="${key}" data-label="${label}" aria-label="${label}: sort ${key === "time" ? "newest first" : "A to Z"}">${label} <span aria-hidden="true">↕</span></button></th>`
  ).join("");
  return renderShell({
    title: "Activity log", active: "timeline", enabled,
    body: `${renderHero({
      eyebrow: "Countersign console / Evidence", title: "Activity log", icon: "timeline",
      description: "Inspect the real audit trail from the demo portal in the Countersign console. Each event preserves the decision and its supporting evidence.",
    })}
    <div class="console-summary" aria-label="How to read the audit trail">
      <section class="panel">
        <p class="eyebrow">Audit source</p><h2>Recorded actions</h2>
        <p class="muted">Polling <code>/countersign/events</code> once per second. Events initially follow append order, newest last. Select a column heading to sort or reverse its order.</p>
      </section>
      <section class="panel">
        <p class="eyebrow">Presence evidence</p><h2>Human verification</h2>
        <p class="muted">Open Event details to inspect the presence proof and assertion ID when present. Authorship labels reflect the user’s disclosure.</p>
      </section>
      <section class="panel">
        <p class="eyebrow">Review context</p><h2>Advisory findings</h2>
        <p class="muted">Agent detection is disabled. Historical events retain their original labels; composition review flags are advisory.</p>
      </section>
    </div>
    <div class="section-heading">
      <div><p class="eyebrow">Provenance timeline</p><h2>Governed events</h2></div>
      <p>Filter by user, then expand the evidence.</p>
    </div>
    <section class="panel" aria-label="Timeline controls">
      <div class="timeline-controls">
        <label for="user-filter">Show user</label>
        <select id="user-filter"><option value="">All users</option></select>
        <button type="button" id="all-users" class="button-quiet">Show all users</button>
      </div>
      <p class="actor-key legend" aria-label="Actor color key">
        <span class="human-verified">human-verified</span>
        <span class="unverified">unverified</span>
      </p>
      <p id="timeline-status" role="status">Waiting for events…</p>
    </section>
    <div class="timeline-scroll"><table>
      <caption class="sr-only">Governed events. Select a column heading to change the sort order.</caption>
      <thead><tr>${headers}<th scope="col">Evidence</th></tr></thead>
      <tbody id="events"><tr><td colspan="7">Waiting for events…</td></tr></tbody>
    </table></div>`,
    scripts: `<script>
    const body = document.querySelector("#events");
    const filter = document.querySelector("#user-filter");
    const status = document.querySelector("#timeline-status");
    const actors = ["human-verified", "unverified"];
    const rows = new Map();
    const sortButtons = [...document.querySelectorAll("[data-sort]")];
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const sortValues = {
      time: event => Date.parse(event.ts),
      user: event => event.user.name + " (" + event.user.id + ")",
      route: event => event.route + " / " + event.action,
      rule: event => event.rule_id || "",
      decision: event => event.decision,
      actor: event => event.actor_class,
    };
    let sortColumn = null;
    let sortDirection = "ascending";
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
      if (sortColumn) {
        const value = sortValues[sortColumn];
        const direction = sortDirection === "ascending" ? 1 : -1;
        visible.sort((a, b) => direction * (sortColumn === "time"
          ? value(a) - value(b)
          : collator.compare(value(a), value(b))));
      }
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
    for (const button of sortButtons) {
      button.addEventListener("click", () => {
        const column = button.dataset.sort;
        sortDirection = sortColumn === column
          ? (sortDirection === "ascending" ? "descending" : "ascending")
          : (column === "time" ? "descending" : "ascending");
        sortColumn = column;
        for (const control of sortButtons) {
          const active = control.dataset.sort === sortColumn;
          if (active) control.closest("th").setAttribute("aria-sort", sortDirection);
          else control.closest("th").removeAttribute("aria-sort");
          control.querySelector("span").textContent = active ? (sortDirection === "ascending" ? "↑" : "↓") : "↕";
          const nextAscending = active ? sortDirection !== "ascending" : control.dataset.sort !== "time";
          const nextOrder = control.dataset.sort === "time"
            ? (nextAscending ? "oldest first" : "newest first")
            : (nextAscending ? "A to Z" : "Z to A");
          control.setAttribute("aria-label", control.dataset.label + ": sort " + nextOrder);
        }
        render();
      });
    }
    refresh();
    setInterval(refresh, 1000);
  </script>`,
  });
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
    const title = {
      "human-required": "Human presence required", attested: "Presence and disclosure",
      marking: "Protected content", unrestricted: "Open access",
    }[rule.class];
    return `<section class="policy-rule" data-rule="${escapeHtml(rule.id)}">
      <div class="policy-toolbar">
        <h3>${title}</h3><span class="badge${changed ? " badge-purple" : ""}">${changed ? "proposed change" : "unchanged"}</span>
      </div>
      <small class="muted">Rule <code class="mono">${escapeHtml(rule.id)}</code> · <code>${escapeHtml(rule.match.route)}</code>${rule.match.action ? ` · <code>${escapeHtml(rule.match.action)}</code>` : ""}</small>
      <p>${escapeHtml(rule.rationale)}</p>
      <div class="action-row">
        <label><input type="checkbox" name="rule_ids" value="${escapeHtml(rule.id)}" ${disabled}> Select this rule</label>
        <button type="button" class="button-secondary" data-approve-rule="${escapeHtml(rule.id)}" ${disabled}>Approve this rule</button>
      </div>
      <div class="policy-grid">
        <section><h4 class="eyebrow muted">Active rule</h4><pre>${escapeHtml(current ? JSON.stringify(current, null, 2) : "Not active")}</pre></section>
        <section><h4 class="eyebrow muted">Draft rule (including citations)</h4><pre>${escapeHtml(JSON.stringify(rule, null, 2))}</pre></section>
      </div>
    </section>`;
  }).join("");

  return renderShell({
    title: "Policy review", active: "policy", enabled: options.enabled,
    body: `${renderHero({
      eyebrow: "Countersign console / Policy", title: "Policy review", icon: "policy",
      description: "Review the rules that govern the demo portal in the Countersign console. Compare generated proposals with active policy, inspect their rationale, and approve changes explicitly.",
    })}
    <div class="console-summary" aria-label="Policy state">
      <section class="panel">
        <p class="eyebrow">Active configuration</p><h2>${active.rules.length} rules configured</h2>
        <p class="muted">Version <code class="mono">${escapeHtml(active.version)}</code></p>
        <span class="badge${options.enabled ? " badge-success" : " badge-warning"}">${options.enabled ? "Governance on" : "Governance off"}</span>
      </section>
      <section class="panel">
        <p class="eyebrow">Generated draft</p><h2>${options.draftError ? "Draft needs attention" : draft ? "Ready for review" : "No draft yet"}</h2>
        <p class="muted">${options.draftError ? "Generate a new draft before approving changes." : draft ? `${draft.rules.length} proposed rules. Compare the rationale and citations below.` : "Generate a proposal to compare with the active configuration."}</p>
        <span class="badge${options.draftError ? " badge-warning" : " badge-purple"}">${options.draftError ? "Invalid draft" : "Approval required to activate"}</span>
      </section>
      <section class="panel">
        <p class="eyebrow">Management access</p><h2>${!options.enabled ? "Governed instance required" : !options.signedIn ? "Sign-in required" : "Ready to manage"}</h2>
        <p class="muted">${!options.enabled ? "Open the governed instance to generate and approve policy." : !options.signedIn ? "Sign in to generate a draft and approve reviewed rules." : "Generate a draft, then choose the reviewed rules to approve."}</p>
      </section>
    </div>
    ${!options.enabled ? `<p class="notice notice-warning">Policy management is available on <a href="${escapeHtml(portalOrigin(true) + "/countersign/policy/review")}">the governed instance</a>.</p>` : !options.signedIn ? '<p class="notice notice-warning"><a href="/login">Sign in</a> to generate or approve a policy.</p>' : ""}
    <section class="panel" aria-labelledby="generation-heading">
      <div class="policy-toolbar">
        <div><p class="eyebrow">Draft generation</p><h2 id="generation-heading">Propose a policy</h2></div>
        <button type="button" id="generate" class="button-primary" ${mayManage ? "" : "disabled"}>Generate draft</button>
      </div>
      <p class="muted">Model: <strong class="mono">${escapeHtml(options.model)}</strong>. Source pages are crawled from the configured local ungoverned portal.</p>
      <p class="muted">Vocabulary: ${options.vocabulary.categories} categories, ${options.vocabulary.ldcs} limited-dissemination controls.</p>
      ${options.vocabulary.placeholder ? '<p class="notice notice-warning">Scaffold vocabulary only — these identifiers and definitions are not authoritative Registry data. Import the hackathon dataset before claiming Registry-backed generation.</p>' : ""}
      <p role="status" id="policy-status">${escapeHtml(options.draftError || "Generation writes a draft only. Review before approval.")}</p>
    </section>
    ${options.metadata ? `<details class="panel policy-json"><summary>Generation provenance</summary><pre>${escapeHtml(JSON.stringify(options.metadata, null, 2))}</pre></details>` : ""}
    <section id="approval" aria-labelledby="approval-heading" data-active-revision="${escapeHtml(options.activeRevision)}" data-draft-revision="${escapeHtml(options.draftRevision)}">
      <div class="section-heading">
        <div><p class="eyebrow">Approval queue</p><h2 id="approval-heading">Review proposed rules</h2></div>
        <p>Read the rationale. Compare the complete rule.</p>
      </div>
      <div class="panel">
        <p class="muted">Per-rule approval preserves active defaults and unselected rules. Approve all replaces the complete policy. Changes take effect on the next request without restarting.</p>
        <div class="action-row">
          <button type="button" id="approve-selected" class="button-primary" ${disabled}>Approve selected</button>
          <button type="button" id="approve-all" class="button-secondary" ${disabled}>Approve all</button>
        </div>
      </div>
      ${cards || `<p class="notice${options.draftError ? " notice-warning" : ""}">${escapeHtml(options.draftError ? "The invalid draft cannot be approved. Generate a new draft." : "No draft policy exists.")}</p>`}
    </section>
    <details class="panel policy-json"><summary>Complete active / draft JSON</summary><div class="policy-grid">
      <section><h2>Active — ${escapeHtml(active.version)}</h2><pre>${activeJson}</pre></section>
      <section><h2>Draft</h2><pre>${draftJson}</pre></section>
    </div></details>`,
    scripts: `<script>
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
  </script>`,
  });
}
