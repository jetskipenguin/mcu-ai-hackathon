const browser = globalThis.SimpleWebAuthnBrowser;

if (!browser) {
  throw new Error("The local SimpleWebAuthn browser bundle was not loaded.");
}

export const startAuthentication = (options) =>
  browser.startAuthentication(options);
export const startRegistration = (options) => browser.startRegistration(options);
