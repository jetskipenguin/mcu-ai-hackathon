import { startAuthentication, startRegistration } from "./vendor/simplewebauthn-browser.js";

const governedForms = [...document.querySelectorAll("form[data-countersign-rule]")];
const composition = new Map();

document.addEventListener(
  "keydown",
  (event) => {
    const state = composition.get(event.target);
    if (state) {
      state.keystrokes += 1;
    }
  },
  true,
);

function compositionState(field) {
  let state = composition.get(field);
  if (!state) {
    state = {
      field: field.name,
      keystrokes: 0,
      inputEvents: 0,
      inputTypes: { insertText: 0, insertFromPaste: 0, other: 0 },
      largestInput: 0,
      previousLength: field.value.length,
      focusedAt: null,
      firstInputAt: null,
      lastInputAt: null,
    };
    composition.set(field, state);
  }
  return state;
}

for (const form of governedForms) {
  for (const field of form.querySelectorAll(
    'textarea[name], input[name][type="text"], input[name]:not([type])',
  )) {
    const state = compositionState(field);
    field.addEventListener("focus", () => {
      state.focusedAt ??= performance.now();
    });
    field.addEventListener("input", (event) => {
      const now = performance.now();
      const nowIso = new Date().toISOString();
      const nextLength = field.value.length;
      const inserted = Math.max(0, nextLength - state.previousLength);
      state.previousLength = nextLength;
      state.inputEvents += 1;
      state.largestInput = Math.max(state.largestInput, inserted);
      state.firstInputAt ??= { performance: now, iso: nowIso };
      state.lastInputAt = { performance: now, iso: nowIso };

      if (event.inputType === "insertText") {
        state.inputTypes.insertText += 1;
      } else if (event.inputType === "insertFromPaste") {
        state.inputTypes.insertFromPaste += 1;
      } else {
        state.inputTypes.other += 1;
      }
    });
  }
}

function setNestedField(target, name, value) {
  const nested = /^([^[]+)\[([^\]]+)\]$/.exec(name);
  if (nested) {
    const [, parent, child] = nested;
    target[parent] ??= {};
    target[parent][child] = value;
    return;
  }

  if (Object.hasOwn(target, name)) {
    target[name] = Array.isArray(target[name])
      ? [...target[name], value]
      : [target[name], value];
    return;
  }
  target[name] = value;
}

function serialize(form) {
  const fields = {};
  for (const [name, value] of new FormData(form).entries()) {
    if (name === "countersign" || name.startsWith("countersign[")) {
      continue;
    }
    setNestedField(fields, name, value);
  }
  return fields;
}

function sortForCanonical(value) {
  if (Array.isArray(value)) {
    return value.map(sortForCanonical);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForCanonical(value[key])]),
    );
  }
  return value;
}

async function sha256Canonical(fields) {
  const canonical = JSON.stringify(sortForCanonical(fields));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function telemetryFor(form) {
  const values = [];
  const now = performance.now();
  for (const field of form.querySelectorAll(
    'textarea[name], input[name][type="text"], input[name]:not([type])',
  )) {
    const state = compositionState(field);
    const finalLength = field.value.length;
    const start = state.focusedAt ?? state.firstInputAt?.performance ?? now;
    values.push({
      field: state.field,
      final_length: finalLength,
      keystrokes: state.keystrokes,
      input_events: state.inputEvents,
      input_types: state.inputTypes,
      single_event_fill:
        finalLength > 0 && state.largestInput >= finalLength * 0.8,
      time_on_field_ms: Math.max(0, Math.round(now - start)),
      first_input_ts: state.firstInputAt?.iso ?? null,
      last_input_ts: state.lastInputAt?.iso ?? null,
    });
  }
  return values.length === 1 ? values[0] : values;
}

function ensureAttestationControl(form) {
  let select = form.querySelector("select[data-countersign-attestation]");
  if (!select) {
    // Keep the injectable client usable on hosts that only annotate their form.
    // The countersign namespace is excluded from the application form hash;
    // the declaration is bound separately by the action challenge.
    const wrapper = document.createElement("div");
    wrapper.className = "attestation-control";
    const label = document.createElement("label");
    label.textContent = "How was this response prepared?";
    select = document.createElement("select");
    let index = 1;
    let id = "countersign-attestation";
    while (document.getElementById(id)) id = `countersign-attestation-${index++}`;
    select.id = id;
    select.name = "countersign[attestation]";
    select.dataset.countersignAttestation = "";
    label.htmlFor = id;
    for (const [value, text] of [["", "Choose a disclosure"], ["own-work", "Own work"], ["ai-assisted", "AI-assisted"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.disabled = value === "";
      option.selected = value === "";
      select.append(option);
    }
    const help = document.createElement("p");
    help.id = `${id}-help`;
    help.className = "form-note";
    help.textContent = "Choose the description that matches how you prepared this response. This disclosure is recorded with your presence check.";
    select.setAttribute("aria-describedby", help.id);
    wrapper.append(label, select, help);
    form.insertBefore(wrapper, form.firstChild);
  }
  select.required = true;
  return select;
}

function readAttestation(select) {
  const answer = select.value;
  if (answer === "own-work" || answer === "ai-assisted") {
    return answer;
  }
  select.reportValidity();
  throw new Error("Choose Own work or AI-assisted before publishing.");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.reason || payload.error || "Request failed");
    error.code = payload.error;
    throw error;
  }
  return payload;
}

function showHumanConfirmation(status, action, explanation) {
  if (!status) return;
  // This is application context, not a replacement for the browser/OS dialog.
  const heading = document.createElement("strong");
  heading.textContent = `Human confirmation required — ${action}`;
  const detail = document.createElement("span");
  detail.textContent = explanation;
  status.replaceChildren(heading, document.createTextNode(" "), detail);
  status.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function showError(status, error) {
  if (!status) return;
  status.textContent =
    error.name === "NotAllowedError" || error.cause?.name === "NotAllowedError"
      ? "A human must confirm this action. You can try again."
      : error.message;
  if (error.code === "registration_required" || error.code === "login_required") {
    const link = document.createElement("a");
    link.href = error.code === "registration_required" ? "/register" : "/login";
    link.textContent = error.code === "registration_required" ? " Register passkey" : " Sign in";
    status.append(link);
  }
}

for (const form of document.querySelectorAll("form[data-countersign-register]")) {
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector("[data-countersign-status]");
    button.disabled = true;
    showHumanConfirmation(status, "set up this passkey", "Follow your device’s passkey prompt. Countersign never receives your fingerprint or other biometric data.");
    try {
      const options = await postJson("/countersign/webauthn/register/options", {});
      const credential = await startRegistration({ optionsJSON: options });
      await postJson("/countersign/webauthn/register/verify", credential);
      status.textContent = "Passkey registered.";
      location.assign("/quiz/1");
    } catch (error) {
      showError(status, error);
    } finally {
      button.disabled = false;
      busy = false;
    }
  });
}

for (const form of governedForms) {
  const attestationControl = form.dataset.countersignClass === "attested" ? ensureAttestationControl(form) : null;
  let busy = false;
  form.addEventListener("submit", async (event) => {
    const rule = form.dataset.countersignRule;
    if (!rule) {
      return;
    }
    event.preventDefault();
    if (busy) return;
    busy = true;
    let submitted = false;
    const buttons = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    const disabled = buttons.map((button) => button.disabled);
    buttons.forEach((button) => { button.disabled = true; });

    const status = form.querySelector("[data-countersign-status]");

    try {
      const attestation = attestationControl ? readAttestation(attestationControl) : null;
      showHumanConfirmation(status, attestationControl ? "publish this response" : rule === "quiz-submit" ? "submit this quiz" : "complete this action",
        `${attestation ? `Disclosure: ${attestation === "own-work" ? "Own work" : "AI-assisted"}. ` : ""}Confirm with Touch ID or your device’s passkey prompt. Nothing is submitted until you verify.`);
      const fields = serialize(form);
      const form_hash = await sha256Canonical(fields);
      const challenge = await postJson("/countersign/challenge", {
        rule_id: rule,
        action: form.dataset.countersignAction,
        form_hash,
        attestation,
      });
      const assertion = await startAuthentication({
        optionsJSON: challenge.options,
      });
      if (await sha256Canonical(serialize(form)) !== form_hash) {
        throw new Error("The form changed during confirmation. Submit again to confirm the new contents.");
      }
      if (attestationControl && attestationControl.value !== attestation) {
        throw new Error("Your disclosure changed during confirmation. Publish again to verify the new choice.");
      }
      const result = await postJson(form.action, {
        ...fields,
        countersign: {
          challenge_id: challenge.challenge_id,
          assertion,
          attestation,
          telemetry: telemetryFor(form),
        },
      });
      submitted = true;
      if (status) {
        status.textContent = result.message || "Action submitted.";
      }
      if (result.redirect) {
        location.assign(result.redirect);
      }
    } catch (error) {
      showError(status, error);
    } finally {
      if (!submitted) {
        busy = false;
        buttons.forEach((button, index) => { button.disabled = disabled[index]; });
      }
    }
  });
}

const record = document.querySelector("[data-protected-record]");
if (record) {
  const status = document.querySelector("[data-record-status]");
  const revealButton = document.querySelector("[data-record-reveal]");
  const registerButton = document.querySelector("[data-record-register]");
  let generation = 0;

  function renderRecord(fields = {}) {
    for (const field of record.querySelectorAll("[data-field]")) {
      field.textContent = fields[field.dataset.field] ?? "[Hidden — verify presence to view]";
    }
  }

  function maskRecord() {
    generation += 1;
    renderRecord();
    status.textContent = "Protected information (PII, PHI, and CUI-marked content) is hidden by default. Human authentication is required to view it.";
  }

  registerButton.addEventListener("click", async () => {
    registerButton.disabled = true;
    try {
      showHumanConfirmation(status, "set up this passkey", "Follow your device’s passkey prompt. Protected fields stay hidden until you separately verify to reveal this view.");
      const options = await postJson("/countersign/webauthn/register/options", {});
      const registration = await startRegistration({ optionsJSON: options });
      await postJson("/countersign/webauthn/register/verify", registration);
      status.textContent = "Passkey registered. Select Verify presence to view the record.";
    } catch (error) {
      status.textContent = error.name === "NotAllowedError" ? "A human must confirm passkey registration." : error.message;
    } finally {
      registerButton.disabled = false;
    }
  });

  revealButton.addEventListener("click", async () => {
    revealButton.disabled = true;
    renderRecord();
    const current = ++generation;
    try {
      showHumanConfirmation(status, "reveal this protected record", "Confirm with Touch ID or your device’s passkey prompt. The fields stay hidden until human verification succeeds.");
      const challenge = await postJson("/countersign/unmask", {
        rule_id: "student-record.unmask", action: "POST /countersign/unmask/verify",
      });
      const assertion = await startAuthentication({ optionsJSON: challenge.options });
      const result = await postJson("/countersign/unmask/verify", { challenge_id: challenge.challenge_id, assertion });
      if (current !== generation) return;
      renderRecord(result.fields);
      status.textContent = "Human presence verified. Record revealed for this view.";
    } catch (error) {
      if (current === generation) status.textContent = error.name === "NotAllowedError"
        ? "A human must confirm this action. Sensitive content remains hidden." : error.message;
    } finally {
      revealButton.disabled = false;
    }
  });

  // Do not leave revealed fields in a background tab or a back/forward-cache
  // snapshot. An older in-flight response must not reveal a now-hidden page.
  window.addEventListener("pagehide", maskRecord);
  window.addEventListener("pageshow", (event) => { if (event.persisted) maskRecord(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) maskRecord(); });
  maskRecord();
}
