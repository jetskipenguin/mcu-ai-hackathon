export const DEMO_ROUTES = ["/quiz/1", "/discussion/2", "/record/1"] as const;

export interface PageSnapshot {
  route: string;
  url: string;
  html: string;
  forms: Array<{ action: string; method: string; fields: string[] }>;
  markedFields: string[];
}

function attribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function snapshot(route: string, origin: string, raw: string): PageSnapshot {
  // These are server-rendered demo pages. Remove executable/style content, not
  // labels or field values. The remaining HTML is data, never instructions.
  const html = raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const forms: PageSnapshot["forms"] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const destination = new URL(attribute(match[1], "action") ?? route, origin);
    if (destination.origin !== origin) throw new Error(`Off-origin form on ${route} is not supported.`);
    const method = (attribute(match[1], "method") ?? "GET").toUpperCase();
    const fields = [...match[2].matchAll(/<(?:input|textarea|select)\b([^>]*)>/gi)]
      .map((item) => attribute(item[1], "name")).filter((name): name is string => Boolean(name));
    forms.push({ method, action: `${method} ${destination.pathname}`, fields: [...new Set(fields)] });
  }
  const markedFields = [...html.matchAll(/<[^>]+\bdata-field\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)]
    .map((item) => item[1] ?? item[2] ?? item[3]);
  return { route, url: new URL(route, origin).href, html, forms, markedFields: [...new Set(markedFields)] };
}

export async function crawlPortal(options: { baseUrl?: string; userId?: string } = {}): Promise<PageSnapshot[]> {
  const base = new URL(options.baseUrl ?? process.env.GENERATOR_BASE_URL ?? "http://localhost:3001");
  if (base.hostname !== "localhost" || base.protocol !== "http:" || base.username || base.password ||
      base.pathname !== "/" || base.search || base.hash) throw new Error("GENERATOR_BASE_URL must be an http://localhost:<port> origin.");
  const request = (path: string, init?: RequestInit) => fetch(new URL(path, base), {
    ...init, redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  const login = await request("/login", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_id: options.userId ?? process.env.GENERATOR_USER_ID ?? "stu-0011" }),
  });
  if (login.status !== 303) throw new Error(`Portal login returned HTTP ${login.status}. Start npm run dev:ungoverned and check GENERATOR_USER_ID.`);
  const cookies = login.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  await login.body?.cancel();
  if (!cookies) throw new Error("Portal login did not create a session.");
  const pages: PageSnapshot[] = [];
  for (const route of DEMO_ROUTES) {
    const response = await request(route, { headers: { cookie: cookies } });
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
      throw new Error(`Crawl of ${route} returned HTTP ${response.status} instead of rendered HTML.`);
    }
    const html = await response.text();
    if (html.length > 200_000) throw new Error(`${route} exceeds the demo crawl size limit.`);
    if (!html.includes("COUNTERSIGN=off")) throw new Error("Crawl the ungoverned instance so record values and initial-post forms are available.");
    pages.push(snapshot(route, base.origin, html));
  }
  if (!pages[0].forms.some((form) => form.action === "POST /quiz/1/submit") ||
      !pages[1].forms.some((form) => form.action === "POST /discussion/2/post")) {
    throw new Error("Expected initial-post/quiz forms are missing. Use the demo student on a fresh ungoverned server.");
  }
  return pages;
}
