import { startAuthentication, startRegistration } from "./vendor/simplewebauthn-browser.js";

const governedForms = [...document.querySelectorAll("form[data-countersign-rule]")];
const composition = new Map();
const filledFields = new Set();
const signalState = {
  pointerEventsBeforeInput: 0,
  keydownEvents: 0,
  firstInputAt: null,
  lastInputAt: null,
  hiddenDuringInput: false,
  focusBeforeFill: false,
};

document.addEventListener(
  "pointerdown",
  () => {
    if (signalState.firstInputAt === null) {
      signalState.pointerEventsBeforeInput += 1;
    }
  },
  true,
);

document.addEventListener(
  "keydown",
  (event) => {
    signalState.keydownEvents += 1;
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

document.addEventListener(
  "input",
  (event) => {
    const now = performance.now();
    signalState.firstInputAt ??= now;
    signalState.lastInputAt = now;
    signalState.hiddenDuringInput ||= document.hidden;
    signalState.focusBeforeFill ||= document.activeElement === event.target;
    if (event.target && event.target.name && event.target.value !== "") {
      filledFields.add(event.target.name);
    }
  },
  true,
);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && signalState.firstInputAt !== null) {
    signalState.hiddenDuringInput = true;
  }
});

function collectSignals() {
  const first = signalState.firstInputAt;
  const last = signalState.lastInputAt;
  return {
    webdriver: navigator.webdriver === true,
    document_hidden: document.hidden,
    document_has_focus: document.hasFocus(),
    pointer_events_before_input: signalState.pointerEventsBeforeInput,
    keydown_events: signalState.keydownEvents,
    fields_filled: filledFields.size,
    fill_span_ms: first === null || last === null ? 0 : Math.round(last - first),
    visibility_hidden_during_input: signalState.hiddenDuringInput,
    focus_before_fill: signalState.focusBeforeFill,
    agent_header_declared: false,
  };
}

function sendSignals() {
  return postJson("/countersign/signals", {
    route: location.pathname,
    signals: collectSignals(),
  });
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

async function askAttestation() {
  // TODO(track-a): replace this scaffold prompt with the attestation UI.
  const answer = window.prompt(
    'Declare this post as "own-work" or "ai-assisted".',
    "own-work",
  );
  if (answer === "own-work" || answer === "ai-assisted") {
    return answer;
  }
  throw new Error("An own-work or ai-assisted attestation is required.");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.reason || payload.error || "Request failed");
  }
  return payload;
}

for (const form of governedForms) {
  form.addEventListener("submit", async (event) => {
    const rule = form.dataset.countersignRule;
    if (!rule) {
      return;
    }
    event.preventDefault();

    const status = form.querySelector("[data-countersign-status]");
    if (status) {
      status.textContent = "Waiting for a human presence check...";
    }

    try {
      await sendSignals();
      const fields = serialize(form);
      const form_hash = await sha256Canonical(fields);
      const attestation =
        rule === "discussion-initial-post" ? await askAttestation() : null;
      const challenge = await postJson("/countersign/challenge", {
        rule_id: rule,
        action: form.dataset.countersignAction,
        form_hash,
        attestation,
      });
      const assertion = await startAuthentication({
        optionsJSON: challenge.options,
      });
      const result = await postJson(form.action, {
        ...fields,
        countersign: {
          challenge_id: challenge.challenge_id,
          assertion,
          attestation,
          telemetry: telemetryFor(form),
        },
      });
      if (status) {
        status.textContent = result.message || "Action submitted.";
      }
      if (result.redirect) {
        location.assign(result.redirect);
      }
    } catch (error) {
      if (status) {
        status.textContent =
          error.name === "NotAllowedError"
            ? "A human must confirm this action."
            : error.message;
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

  async function checkRecord() {
    const current = ++generation;
    renderRecord();
    try {
      // The server evaluates signals before returning any field values.
      const result = await postJson("/countersign/record-fields", { signals: collectSignals() });
      if (current !== generation) return;
      if (result.masked) {
        status.textContent = result.flagged
          ? "Automation suspected. Sensitive content hidden — verify presence to view."
          : "Sensitive content hidden — verify presence to view.";
      } else {
        renderRecord(result.fields);
        status.textContent = "No automation signals above threshold. This is not proof of human presence.";
      }
    } catch {
      if (current === generation) status.textContent = "Sensitive content hidden. Signal check unavailable — verify presence to view.";
    }
  }

  registerButton.addEventListener("click", async () => {
    registerButton.disabled = true;
    try {
      status.textContent = "A human must register a passkey using the device authenticator.";
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
    const current = ++generation;
    try {
      status.textContent = "Waiting for a human presence check...";
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
  window.addEventListener("pagehide", () => { generation += 1; renderRecord(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) checkRecord(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) checkRecord(); });
  checkRecord();
} else {
  sendSignals().catch(() => {
    // Signals are advisory; an unavailable signal endpoint must not block a form.
  });
}
