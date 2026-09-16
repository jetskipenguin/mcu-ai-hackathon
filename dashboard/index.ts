import type { CountersignPolicy } from "../countersign/server/types.js";

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
): string {
  const activeJson = escapeHtml(JSON.stringify(active, null, 2));
  const draftJson = draft
    ? escapeHtml(JSON.stringify(draft, null, 2))
    : "No draft policy exists.";

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
    <p>The approval controls are scaffold placeholders; this view does not change the active policy.</p>
    <div class="policy-grid">
      <section><h2>Active</h2><pre>${activeJson}</pre></section>
      <section><h2>Draft</h2><pre>${draftJson}</pre></section>
    </div>
  </main>
</body>
</html>`;
}
