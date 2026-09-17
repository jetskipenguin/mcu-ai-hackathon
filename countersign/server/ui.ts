import { portalOrigin } from "./origin.js";

export type PageId = "home" | "quiz" | "discussion" | "record" | "register" | "timeline" | "policy";
export type IconName = "shield" | "arrow" | "quiz" | "discussion" | "record" | "timeline" | "policy" | "key" | "check" | "user";

export function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const paths: Record<IconName, string> = {
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3 7.5 7.5 9.5 4.5-2 7.5-5 7.5-9.5V6L12 3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  quiz: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h3"/>',
  discussion: '<path d="M20 11a8 8 0 0 1-8 8H5l-4 3 1.7-6A8 8 0 1 1 20 11Z"/><path d="M7 9h8M7 13h5"/>',
  record: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  timeline: '<path d="M5 4v16M9 5h11M9 12h8M9 19h11"/><circle cx="5" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="19" r="1"/>',
  policy: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-5-5 3-3m0 6 3-3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
};

export function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

const links: Array<{ id: PageId; href: string; label: string; icon: IconName; area: "demo" | "console" }> = [
  { id: "home", href: "/login", label: "Demo home", icon: "shield", area: "demo" },
  { id: "quiz", href: "/quiz/1", label: "Quiz", icon: "quiz", area: "demo" },
  { id: "discussion", href: "/discussion/2", label: "Discussion", icon: "discussion", area: "demo" },
  { id: "record", href: "/record/1", label: "Protected record", icon: "record", area: "demo" },
  { id: "timeline", href: "/countersign/", label: "Activity log", icon: "timeline", area: "console" },
  { id: "policy", href: "/countersign/policy/review", label: "Policy review", icon: "policy", area: "console" },
];

export function renderHero(options: {
  eyebrow: string; title: string; description: string; icon?: IconName; meta?: string;
}): string {
  return `<section class="page-hero" aria-label="Page introduction">
    <div class="hero-copy"><p class="eyebrow">${escapeHtml(options.eyebrow)}</p>
      <h1>${escapeHtml(options.title)}</h1><p class="hero-description">${escapeHtml(options.description)}</p>
      ${options.meta ? `<span class="hero-meta">${icon("check")}${escapeHtml(options.meta)}</span>` : ""}
    </div>${options.icon ? `<div class="hero-emblem">${icon(options.icon)}</div>` : ""}
  </section>`;
}

/** Body/scripts are trusted renderer markup; data interpolated into them must be escaped. */
export function renderShell(options: {
  title: string; active: PageId; enabled: boolean; body: string; footer?: string; scripts?: string;
}): string {
  const { title, active, enabled, body } = options;
  const consolePage = active === "timeline" || active === "policy";
  const area = consolePage ? "Countersign console" : "Demo portal";
  const otherPath = links.find(link => link.id === active)?.href ?? "/login";
  const navigation = (group: "demo" | "console", label: string) => `<nav class="nav-group" aria-label="${label}">
    <span class="nav-label">${label}</span><div class="nav-links">${links.filter(link => link.area === group).map(link =>
      `<a class="nav-link${active === link.id ? " is-active" : ""}" href="${link.href}"${active === link.id ? ' aria-current="page"' : ""}>${icon(link.icon)}<span>${link.label}</span></a>`).join("")}</div>
  </nav>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light"><title>${escapeHtml(title)} · ${area} — Countersign</title>
  <link rel="stylesheet" href="/assets/site.css">
</head><body class="${consolePage ? "console-page" : "demo-page"}" data-governance="${enabled ? "on" : "off"}">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <div class="brand-row frame">
      <a class="brand" href="/login" aria-label="Countersign demo home"><span class="brand-mark">${icon("shield")}</span>
        <span><strong>countersign<span class="brand-dot">.</span></strong><small>Human verification for web apps</small></span></a>
      <div class="header-tools">
        <span class="mode-pill ${enabled ? "mode-on" : "mode-off"}"><span class="status-dot"></span>Governance ${enabled ? "on" : "off"}<span class="sr-only"> — COUNTERSIGN=${enabled ? "on" : "off"}</span></span>
        ${enabled ? `<a class="utility-link" href="/register"${active === "register" ? ' aria-current="page"' : ""}>${icon("key")}Passkey setup</a>` : ""}
        <a class="utility-link" href="/login#demo-users">${icon("user")}Choose demo user</a>
      </div>
    </div>
    <div class="navigation-row frame">${navigation("demo", "Demo portal")}${navigation("console", "Countersign console")}</div>
  </header>
  <div class="context-bar frame"><p><span class="context-label">${area}</span><span class="context-description">${consolePage ? "The governance layer: inspect evidence and review policy." : "The example app: synthetic activities governed by Countersign."}</span></p>
    <a class="instance-link" data-instance-switch href="${escapeHtml(portalOrigin(!enabled) + otherPath)}">${enabled ? "Compare without governance" : "Open governed demo"}${icon("arrow")}</a>
  </div>
  <main id="main-content" class="frame page-content" tabindex="-1">${body}</main>
  <footer class="site-footer"><div class="frame footer-content"><div class="footer-label">${icon("shield")}Countersign demonstration</div>
    <p data-synthetic-notice>${escapeHtml(options.footer ?? "Synthetic demonstration data only. No real student records.")}</p>
    <p class="footer-note">Human-presence checks confirm participation in an action. Authorship labels reflect users’ declarations.</p>
  </div></footer>
  ${options.scripts ?? ""}
</body></html>`;
}
