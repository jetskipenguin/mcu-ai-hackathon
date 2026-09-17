import { isIP } from "node:net";

export function portalOrigin(enabled: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const key = enabled ? "PUBLIC_ORIGIN" : "UNGOVERNED_ORIGIN";
  const value = env[key] || `http://localhost:${enabled ? 3000 : 3001}`;
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) ||
      isIP(url.hostname) || url.hostname.startsWith("[") ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${key} must be an HTTPS hostname origin (or HTTP localhost for local demos).`);
  }
  return url.origin;
}
