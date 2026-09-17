/* Editable presentation artifact, not an application dependency or build step.
 * Install the pinned generator in node_modules/.cache/presentation-tools;
 * see README.md. Every diagram is native PowerPoint geometry and text.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const PptxGenJS = require(path.join(ROOT, 'node_modules/.cache/presentation-tools/node_modules/pptxgenjs'));
const pptx = new PptxGenJS();
const ST = pptx.ShapeType;
const C = {
  navy: '10243A', navy2: '17354A', teal: '006D68', mint: 'BCF58A', white: 'FFFFFF',
  ink: '18283D', muted: '54647B', pale: 'F3F6FA', line: 'DCE4EE', soft: 'EAF4EF',
  slate: '8CA5B6', amber: 'F6C66C', amberBg: 'FFF4DD', tint: 'F4FAF6',
};
const W = 13.333333, H = 7.5;
const FONT = 'Arial';
const layout = [];
let slideIndex = 0;
const demoPath = path.join(__dirname, 'Countersign-demo.mp4');
const hasDemo = fs.existsSync(demoPath);
const demo = hasDemo ? JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-video.json'), 'utf8')) : null;
if (hasDemo) {
  assert.equal(createHash('sha256').update(fs.readFileSync(demoPath)).digest('hex'), demo.sha256,
    'The movie must match its verified edit manifest before embedding.');
}

pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Countersign team';
pptx.subject = 'Seven-minute hackathon pitch with three-minute Q&A';
pptx.title = 'Countersign — AI where it helps. Humans where it matters.';
pptx.company = 'Countersign';
pptx.lang = 'en-US';
pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: 'en-US' };

function register(kind, x, y, w, h, text = '') {
  for (const n of [x, y, w, h]) assert.ok(Number.isFinite(n), `${kind}: invalid coordinate`);
  assert.ok(x >= -0.01 && y >= -0.01 && w >= 0 && h >= 0, `${kind}: negative box`);
  assert.ok(x + w <= W + 0.01 && y + h <= H + 0.01, `${kind}: off-canvas ${text}`);
  layout.push({ slide: slideIndex, kind, x, y, w, h, text });
}
function shape(slide, type, x, y, w, h, fill, line = fill, extra = {}) {
  register('shape', x, y, w, h);
  slide.addShape(type, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 1 }, ...extra });
}
function box(slide, x, y, w, h, fill = C.white, line = fill, extra = {}) {
  shape(slide, ST.roundRect, x, y, w, h, fill, line, { radius: 0.12, rectRadius: 0.12, ...extra });
}
function rect(slide, x, y, w, h, fill, extra = {}) {
  shape(slide, ST.rect, x, y, w, h, fill, fill, extra);
}
function ellipse(slide, x, y, w, h, fill, line = fill, extra = {}) {
  shape(slide, ST.ellipse, x, y, w, h, fill, line, extra);
}
function text(slide, value, x, y, w, h, size = 24, color = C.ink, extra = {}) {
  register('text', x, y, w, h, value);
  slide.addText(value, {
    x, y, w, h, fontFace: FONT, fontSize: size, color, margin: 0,
    breakLine: false, valign: 'mid', paraSpaceAfterPt: 0,
    ...extra,
  });
}
function line(slide, x1, y1, x2, y2, color = C.teal, width = 1.6, arrow = false, extra = {}) {
  const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  register('line', x, y, w, h);
  slide.addShape(ST.line, {
    x, y, w, h, flipH: x2 < x1, flipV: y2 < y1,
    line: { color, width, ...(arrow ? { endArrowType: 'triangle' } : {}), ...extra },
  });
}
function label(slide, value, x, y, w, color = C.teal, extra = {}) {
  text(slide, value, x, y, w, 0.22, 11.5, color, { bold: true, charSpacing: 1.2, ...extra });
}
function pill(slide, value, x, y, w, fill, color, extra = {}) {
  box(slide, x, y, w, 0.42, fill, fill);
  text(slide, value, x + 0.09, y + 0.02, w - 0.18, 0.37, 12.3, color,
    { bold: true, align: 'center', ...extra });
}
function image(slide, file, x, y, w, h, alt) {
  register('image', x, y, w, h, alt);
  slide.addImage({ path: path.join(__dirname, 'assets', file), x, y, w, h, altText: alt });
}
function icon(slide, name, x, y, s, color = C.teal, background = C.white) {
  const l = (a, b, c, d, width = 2) => line(slide, x + a * s, y + b * s, x + c * s, y + d * s, color, width);
  const e = (a, b, c, d) => ellipse(slide, x + a * s, y + b * s, c * s, d * s, background, color, { line: { color, width: 2 } });
  const r = (a, b, c, d) => box(slide, x + a * s, y + b * s, c * s, d * s, background, color, { line: { color, width: 2 } });
  if (name === 'human') {
    e(0.33, 0.04, 0.34, 0.34);
    l(0.14, 0.91, 0.14, 0.74); l(0.14, 0.74, 0.31, 0.55);
    l(0.31, 0.55, 0.69, 0.55); l(0.69, 0.55, 0.86, 0.74); l(0.86, 0.74, 0.86, 0.91);
  } else if (name === 'shield') {
    const pts = [[0.5, 0.03], [0.91, 0.20], [0.86, 0.66], [0.70, 0.84], [0.5, 0.99], [0.30, 0.84], [0.14, 0.66], [0.09, 0.20], [0.5, 0.03]];
    for (let i = 1; i < pts.length; i++) l(...pts[i - 1], ...pts[i], 2.4);
    l(0.30, 0.51, 0.45, 0.67, 2.6); l(0.45, 0.67, 0.73, 0.36, 2.6);
  } else if (name === 'page' || name === 'log') {
    r(0.17, 0.06, 0.66, 0.86);
    for (const yy of [0.30, 0.49, 0.68]) l(0.31, yy, name === 'log' && yy === 0.68 ? 0.56 : 0.68, yy);
  } else if (name === 'spark') {
    const pts = [[0.50, 0.04], [0.62, 0.36], [0.94, 0.48], [0.62, 0.60], [0.50, 0.93], [0.38, 0.60], [0.06, 0.48], [0.38, 0.36], [0.50, 0.04]];
    for (let i = 1; i < pts.length; i++) l(...pts[i - 1], ...pts[i]);
  } else if (name === 'lock') {
    l(0.28, 0.43, 0.28, 0.22); l(0.28, 0.22, 0.38, 0.10);
    l(0.38, 0.10, 0.62, 0.10); l(0.62, 0.10, 0.72, 0.22); l(0.72, 0.22, 0.72, 0.43);
    r(0.13, 0.41, 0.74, 0.49); l(0.5, 0.58, 0.5, 0.73);
  } else if (name === 'bank') {
    l(0.07, 0.29, 0.50, 0.06); l(0.50, 0.06, 0.93, 0.29); l(0.07, 0.32, 0.93, 0.32);
    for (const xx of [0.22, 0.50, 0.78]) l(xx, 0.40, xx, 0.80);
    l(0.06, 0.90, 0.94, 0.90); l(0.14, 0.82, 0.86, 0.82);
  } else if (name === 'server') {
    for (const yy of [0.12, 0.57]) { r(0.08, yy, 0.84, 0.29); l(0.22, yy + 0.145, 0.26, yy + 0.145, 3); l(0.41, yy + 0.145, 0.77, yy + 0.145); }
  } else if (name === 'check') {
    l(0.12, 0.50, 0.40, 0.78, 3); l(0.40, 0.78, 0.92, 0.14, 3);
  }
}

function newSlide(section, dark = false) {
  const slide = pptx.addSlide();
  slideIndex++;
  slide.background = { color: dark ? C.navy : C.pale };
  label(slide, section, 0.72, 0.42, 8.5, dark ? C.mint : C.teal);
  text(slide, 'countersign.', 10.35, 0.40, 2.27, 0.28, 15, dark ? C.white : C.navy, { bold: true, align: 'right' });
  line(slide, 0.72, 7.04, 12.61, 7.04, dark ? '2D485A' : C.line, 0.7);
  text(slide, 'HUMAN VERIFICATION FOR WEB APPS', 0.74, 7.15, 9.2, 0.16, 8.5, dark ? C.slate : C.muted, { charSpacing: 1.1 });
  text(slide, String(slideIndex).padStart(2, '0'), 12.06, 7.13, 0.52, 0.20, 10, dark ? C.slate : C.muted, { align: 'right' });
  return slide;
}
function title(slide, value, dark = false, size = 38) {
  text(slide, value, 0.72, 1.06, 11.95, 0.77, size, dark ? C.white : C.navy, { bold: true });
}

const pitch = fs.readFileSync(path.join(ROOT, 'docs/countersign-pitch.md'), 'utf8');
const times = [35, 35, 105, 45, 50, 45, 45, 30];
const clocks = ['0:00–0:35', '0:35–1:10', '1:10–2:55', '2:55–3:40', '3:40–4:30', '4:30–5:15', '5:15–6:00', '6:00–6:30'];
const extraNotes = [
  'Lead with the training use case. The question is fresh confirmation, not identifying a malicious bot. Optional: add presenter names to the small brand area after assigning roles.',
  'Explain the military countersign meaning once. The human/passkey graphic is conceptual, not a native authenticator dialog.',
  hasDemo
    ? `RECORDED DEMO — ${demo.duration_seconds} seconds, embedded in this slide. In Slide Show, click the video itself to play. Narrate live; the MP4 is intentionally silent. Keep Countersign-demo.mp4 as the standalone fallback. Do not call this a live interaction.\n\nVideo clock: 0:00–0:30 governance off; 0:30–1:04.5 governance on; 1:04.5–1:15.5 matching audit. Use the remaining 29.5 seconds of the 1:45 slide allocation for introduction and landing line.\n\nThe recordings show the real Chrome ChatGPT extension and native Touch ID UI, not a virtual authenticator. Waiting intervals are trimmed. Governed source 34–56.5 seconds remains contiguous at real time; a spatial zoom changes framing only. The final eight seconds are explicitly a still from this same recording's audit at source time 78 seconds. Session data is cropped out and the credential identifier is visibly masked.\n\nMatching actual assertion: ${demo.evidence.assertion_id}; UP=true, UV=true, age=${demo.evidence.age_ms}ms. This verifies participation, not authorship, comprehension, or which finger was used. Native prompt, result, and audit are not substituted from another run. See demo-edit.json, demo-video.json, and recording-session.md.\n\nPowerPoint/Keynote playback on the presenting laptop and the timed rehearsal still need a human check.`
    : 'LIVE-DEMO FALLBACK — no movie was found at build time. The picture is a static governed-quiz UI reference, not footage of an extension or native prompt. Use prepared Chrome tabs and show their matching audit event; do not narrate the static picture as the real interaction.',
  'The published badges are a real app screenshot from an isolated Chrome virtual-authenticator test. The footer says so. They demonstrate UI and disclosure semantics, NOT a physical Touch ID interaction or a ChatGPT-extension run. The record crop shows synthetic fields withheld by default. Discuss disclosure for ~35s and protected records for ~10s. After reveal, an extension can read the data.',
  'All diagram elements are editable PowerPoint text/shapes. Gray/white is the existing app; teal/mint is Countersign. Arrows illustrate the governed action, not every possible request. The server gate is mandatory. Express is the demonstrated implementation; no universal SDK or governance-injection proxy is claimed.',
  'Policy-review images are separate detail crops of the real current UI. Active and draft policies were identical at capture. No model call and no approval were performed for the capture. This shows the approval interface, not a claim of live generation. Do not change the known-good policy on stage. The current crawler covers three demo routes. Runtime verification does not call an LLM.',
  'The training portal is built; finance, access, and operations are POTENTIAL integrations. Fresh confirmation does not replace authorization, separation of duties, domain safety, or comprehension. A medication order can be a Q&A example, but do not imply medical readiness.',
  'Close at 6:30 and keep 30 seconds for recovery. Leave this slide visible during the separately allocated three minutes of Q&A. Do not add a funding ask or a deployment commitment.',
];
function notes(slide, n) {
  const match = pitch.match(new RegExp(`### Slide ${n} —[\\s\\S]*?(?=\\n### Slide |\\n## 4\\.)`));
  assert.ok(match, `Missing pitch section for slide ${n}`);
  const spoken = match[0].replace(/\*\*/g, '').replace(/^> ?/gm, '').replace(/^#{1,3} /gm, '');
  let content = `SLIDE ${n} · ${times[n - 1]} seconds · ${clocks[n - 1]}\n\n${spoken}\n\nPRODUCTION / EVIDENCE NOTES\n${extraNotes[n - 1]}`;
  if (n === 8) {
    const qa = pitch.match(/## 8\. Three-minute Q&A preparation[\s\S]*?(?=\n## 9\.)/);
    content += '\n\nQ&A REFERENCE\n' + qa[0].replace(/\*\*/g, '');
  }
  slide.addNotes(content);
}

// 1 — The session/decision gap. Native, editable diagram; no fake UI.
{
  const s = newSlide('WHAT / THE TRAINING USE CASE', true);
  text(s, 'A valid session is not a', 0.75, 1.38, 11.7, 0.78, 43, C.white, { bold: true });
  text(s, 'human decision.', 0.75, 2.18, 11.7, 0.85, 48, C.mint, { bold: true });
  box(s, 0.75, 3.63, 11.84, 2.85, C.navy2, '2A485D');
  label(s, 'ONE LOGGED-IN SESSION', 1.08, 3.94, 8, C.slate);
  line(s, 3.78, 5.07, 5.25, 5.07, C.slate, 2.2, true);
  line(s, 7.80, 5.07, 9.28, 5.07, C.slate, 2.2, true);
  const steps = [
    { x: 1.37, name: 'Learner', icon: 'human', color: C.white },
    { x: 5.39, name: 'AI assistant', icon: 'spark', color: C.white },
    { x: 9.41, name: 'Submit', icon: 'page', color: C.amber },
  ];
  for (const p of steps) {
    icon(s, p.icon, p.x + 0.63, 4.48, 0.90, p.color, C.navy2);
    text(s, p.name, p.x, 5.65, 2.17, 0.37, 21, p.color, { bold: true, align: 'center' });
  }
  ellipse(s, 11.38, 4.34, 0.45, 0.45, C.amber);
  text(s, '?', 11.39, 4.36, 0.43, 0.38, 19, C.navy, { bold: true, align: 'center' });
  notes(s, 1);
}

// 2 — The name and the human checkpoint.
{
  const s = newSlide('WHAT / THE HUMAN CHECKPOINT');
  text(s, 'Countersign.', 0.73, 1.00, 10.5, 0.83, 49, C.navy, { bold: true });
  text(s, 'AI where it helps. Humans where it matters.', 0.76, 2.05, 11.6, 0.48, 25, C.teal);
  line(s, 3.69, 4.55, 4.76, 4.55, C.teal, 2.4, true);
  line(s, 8.55, 4.55, 9.55, 4.55, C.teal, 2.4, true);
  box(s, 0.77, 3.63, 2.95, 1.91, C.white, C.line);
  box(s, 4.83, 3.13, 3.69, 2.90, C.mint);
  box(s, 9.63, 3.63, 2.95, 1.91, C.white, C.line);
  icon(s, 'page', 1.83, 3.95, 0.74, C.teal);
  icon(s, 'shield', 6.12, 3.49, 1.07, C.navy, C.mint);
  icon(s, 'log', 10.74, 3.95, 0.74, C.teal);
  text(s, 'Action', 1.04, 4.93, 2.4, 0.38, 22, C.ink, { bold: true, align: 'center' });
  text(s, 'Human\nconfirmation', 5.04, 4.85, 3.26, 0.87, 23, C.navy, { bold: true, align: 'center' });
  text(s, 'Decision record', 9.78, 4.93, 2.65, 0.38, 19.5, C.ink, { bold: true, align: 'center' });
  text(s, 'A challenge. A human response.', 0.75, 6.44, 8.6, 0.3, 17, C.muted);
  pill(s, 'WebAuthn / passkeys', 9.60, 6.33, 2.97, C.soft, C.teal);
  notes(s, 2);
}

// 3 — Nearly full-frame local video; offline, click-to-play, with a real poster.
if (hasDemo) {
  const s = pptx.addSlide();
  slideIndex++;
  s.background = { color: C.navy };
  text(s, 'Same task. Different boundary.', 0.54, 0.12, 9.72, 0.35, 23, C.white, { bold: true });
  text(s, 'RECORDED · 1:15', 10.55, 0.19, 2.22, 0.24, 12, C.mint, { bold: true, align: 'right' });
  // PDF exporters can omit the video's cover. A matching static underlay keeps
  // the PDF useful while the higher-z-order native media object receives clicks.
  image(s, 'demo-poster.png', 0.54, 0.61, 12.24, 6.885,
    'Static preview of the real recorded native prompt; the PPT video overlays this image.');
  register('video', 0.54, 0.61, 12.24, 6.885, 'Recorded Chrome extension demo and matching proof');
  s.addMedia({ type: 'video', path: demoPath, x: 0.54, y: 0.61, w: 12.24, h: 6.885,
    cover: 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets/demo-poster.png')).toString('base64'),
    objectName: 'Recorded quiz demo — governance off/on, native confirmation, matching audit',
  });
  notes(s, 3);
} else {
  const s = newSlide('SO WHAT / THE DEMO');
  title(s, 'Same task. Different boundary.');
  text(s, 'ChatGPT extension · Chrome', 0.75, 1.88, 9.5, 0.35, 18, C.muted);
  box(s, 0.75, 2.47, 11.84, 4.06, C.navy);
  image(s, 'quiz-submit.png', 1.02, 2.78, 6.29, 3.21, 'Real governed quiz UI crop; no recorded extension or native prompt.');
  text(s, 'Governed quiz · UI reference', 1.10, 6.12, 6.2, 0.20, 10.5, C.slate);
  pill(s, 'Governance off', 7.76, 2.78, 2.00, C.navy2, C.white, { hyperlink: { url: 'http://localhost:3001/quiz/1', tooltip: 'Open the ungoverned quiz' } });
  pill(s, 'Governance on', 9.95, 2.78, 2.13, C.mint, C.navy, { hyperlink: { url: 'http://localhost:3000/quiz/1', tooltip: 'Open the governed quiz' } });
  ellipse(s, 9.35, 3.58, 0.98, 0.98, C.navy2, C.slate);
  shape(s, ST.triangle, 9.72, 3.87, 0.30, 0.35, C.mint, C.mint, { rotate: 90 });
  text(s, 'Live demo', 7.78, 4.92, 4.35, 0.44, 28, C.white, { bold: true, align: 'center' });
  text(s, 'or insert your recording', 7.78, 5.42, 4.35, 0.33, 17, C.slate, { align: 'center' });
  text(s, 'Prepare → Confirm → Inspect proof', 7.67, 6.07, 4.58, 0.22, 12.2, C.mint, { align: 'center' });
  notes(s, 3);
}

// 4 — Disclosure is distinct from verified presence. Data gets a small inset.
{
  const s = newSlide('SO WHAT / ACCOUNTABLE PARTICIPATION');
  title(s, 'Participation ≠ authorship.');
  box(s, 0.75, 2.24, 7.95, 4.13, C.white, C.line);
  label(s, 'DISCUSSION', 1.08, 2.57, 6.7);
  pill(s, 'Own work', 1.08, 3.09, 2.05, C.pale, C.muted);
  pill(s, 'AI-assisted', 3.32, 3.09, 2.19, C.mint, C.navy);
  line(s, 5.74, 3.31, 6.29, 3.31, C.teal, 1.7, true);
  text(s, 'Confirm', 6.45, 3.10, 1.68, 0.38, 21, C.teal, { bold: true });
  label(s, 'PUBLISHED DISCLOSURE', 1.10, 3.98, 6.9, C.muted);
  image(s, 'discussion-disclosure.png', 1.09, 4.43, 7.26, 1.207, 'Published AI-assisted and verified-presence badges; isolated virtual-authenticator UI capture.');
  text(s, 'Automated UI reference · virtual authenticator', 1.10, 5.93, 7.1, 0.25, 12, C.muted);
  box(s, 9.01, 2.24, 3.58, 4.13, C.soft, 'D2E4DD');
  icon(s, 'lock', 10.40, 2.62, 0.76, C.teal, C.soft);
  text(s, 'Protected record', 9.28, 3.61, 3.03, 0.37, 21, C.navy, { bold: true, align: 'center' });
  image(s, 'record-masked.png', 9.29, 4.17, 3.02, 0.86, 'Real synthetic SSN and DoD ID fields withheld by default; UI reference.');
  text(s, 'Masked → Confirm → Reveal', 9.26, 5.40, 3.08, 0.31, 13.8, C.teal, { bold: true, align: 'center' });
  text(s, 'Extensions can read after reveal.', 9.25, 5.97, 3.11, 0.22, 10.5, C.muted, { align: 'center' });
  notes(s, 4);
}

// 5 — Native PowerPoint blocks, connectors, and labels, not a flattened SVG.
{
  const s = newSlide('NOW WHAT / REUSABLE INTEGRATION');
  title(s, 'Add a checkpoint, not a new app.', false, 36);
  text(s, 'New application or existing application', 0.76, 1.88, 10.8, 0.32, 18, C.muted);
  box(s, 0.76, 2.54, 3.20, 3.64, C.white, C.line);
  box(s, 4.53, 2.54, 8.05, 3.64, 'EAF0F4', C.line);
  label(s, 'BROWSER', 1.05, 2.83, 2.55, C.muted);
  label(s, 'YOUR APPLICATION SERVER', 4.84, 2.83, 6.9, C.muted);
  line(s, 3.65, 3.96, 5.02, 3.96, C.teal, 2.2, true);
  line(s, 8.06, 3.96, 9.12, 3.96, C.teal, 2.2, true);
  text(s, 'Verified', 8.10, 3.55, 0.99, 0.23, 10.8, C.teal, { bold: true, align: 'center' });
  box(s, 1.05, 3.41, 2.58, 1.10, C.pale, C.line);
  text(s, 'Your page', 1.22, 3.61, 2.24, 0.33, 21, C.navy, { bold: true, align: 'center' });
  text(s, '+ countersign.js', 1.20, 4.04, 2.28, 0.27, 14, C.teal, { align: 'center' });
  box(s, 5.06, 3.41, 2.97, 1.10, C.navy);
  text(s, 'Countersign\nserver gate', 5.24, 3.57, 2.61, 0.76, 21, C.mint, { bold: true, align: 'center' });
  box(s, 9.17, 3.41, 3.03, 1.10, C.white, C.line);
  text(s, 'Your action\n+ data', 9.36, 3.60, 2.65, 0.71, 21, C.navy, { bold: true, align: 'center' });
  line(s, 2.33, 5.14, 2.33, 4.53, C.teal, 1.5, true);
  icon(s, 'human', 1.25, 5.17, 0.47, C.teal);
  text(s, 'Human +\npasskey', 1.92, 5.14, 1.62, 0.60, 16, C.teal, { bold: true });
  line(s, 5.80, 5.18, 5.80, 4.53, C.teal, 1.5, true);
  pill(s, 'Policy', 5.05, 5.25, 1.51, C.soft, C.teal);
  line(s, 7.33, 4.53, 7.33, 5.16, 'A27B3B', 1.5, true);
  pill(s, 'Reject', 6.69, 5.25, 1.33, C.amberBg, '815011');
  line(s, 8.04, 4.23, 8.52, 4.23, C.teal, 1.2);
  line(s, 8.52, 4.23, 8.52, 5.46, C.teal, 1.2);
  line(s, 8.52, 5.46, 9.16, 5.46, C.teal, 1.2, true);
  pill(s, 'Decision log', 9.19, 5.25, 2.99, C.white, C.teal);
  text(s, 'Client + server integration · Demonstrated in Express', 0.77, 6.57, 11.8, 0.25, 14, C.muted);
  notes(s, 5);
}

// 6 — AI helps make policy; a person activates it. No LLM in the runtime gate.
{
  const s = newSlide('NOW WHAT / AI IN THE SOLUTION');
  title(s, 'AI drafts. People approve.', false, 41);
  const cards = [
    { x: 0.76, name: 'App pages', icon: 'page', fill: C.white, color: C.teal },
    { x: 3.78, name: 'AI draft', icon: 'spark', fill: C.white, color: C.teal },
    { x: 6.80, name: 'Human review', icon: 'human', fill: C.mint, color: C.navy },
    { x: 9.82, name: 'Active policy', icon: 'check', fill: C.white, color: C.teal },
  ];
  for (let i = 0; i < 3; i++) line(s, cards[i].x + 2.64, 3.21, cards[i + 1].x - 0.09, 3.21, C.teal, 1.8, true);
  for (const card of cards) {
    box(s, card.x, 2.40, 2.75, 1.84, card.fill, card.fill === C.white ? C.line : card.fill);
    icon(s, card.icon, card.x + 1.01, 2.69, 0.66, card.color, card.fill);
    text(s, card.name, card.x + 0.10, 3.63, 2.55, 0.32, 19.2, card.color, { bold: true, align: 'center' });
  }
  box(s, 0.76, 4.67, 11.82, 1.90, C.white, C.line);
  label(s, 'THE ACTIVATION BOUNDARY', 1.06, 4.98, 5.9);
  text(s, 'Draft ≠ active.', 1.06, 5.49, 5.6, 0.62, 33, C.navy, { bold: true });
  image(s, 'policy-rule-heading.png', 7.19, 4.99, 4.94, 0.596, 'Real current quiz-policy title and route; current active and draft are identical.');
  image(s, 'policy-approve-control.png', 8.28, 5.66, 2.40, 0.72, 'Real Approve this rule control; no approval or new generation was performed for capture.');
  text(s, 'Policy-review UI · detail crops', 7.18, 6.68, 5.13, 0.16, 9.5, C.muted, { align: 'center' });
  notes(s, 6);
}

// 7 — One built example; three clearly distinguished potential integrations.
{
  const s = newSlide('NOW WHAT / BEYOND TRAINING', true);
  title(s, 'Training is the starting point.', true, 38);
  label(s, 'BUILT', 0.80, 2.22, 2.72, C.mint);
  label(s, 'POTENTIAL APPLICATIONS', 3.83, 2.22, 8.5, C.slate);
  const cards = [
    { x: 0.77, name: 'Training', action: 'Confirm\nsubmission', icon: 'page', fill: C.mint, color: C.navy },
    { x: 3.80, name: 'Finance', action: 'Release\npayment', icon: 'bank', fill: C.navy2, color: C.white },
    { x: 6.83, name: 'Access', action: 'Grant\nprivilege', icon: 'lock', fill: C.navy2, color: C.white },
    { x: 9.86, name: 'Operations', action: 'Authorize\nproduction change', icon: 'server', fill: C.navy2, color: C.white },
  ];
  for (const card of cards) {
    box(s, card.x, 2.73, 2.70, 3.29, card.fill, card.fill === C.mint ? C.mint : '335368');
    icon(s, card.icon, card.x + 0.91, 3.13, 0.87, card.fill === C.mint ? C.navy : C.mint, card.fill);
    text(s, card.name, card.x + 0.17, 4.41, 2.36, 0.39, 22, card.color, { bold: true, align: 'center' });
    text(s, card.action, card.x + 0.13, 5.04, 2.44, 0.69, 17, card.fill === C.mint ? C.navy : C.slate, { align: 'center' });
  }
  text(s, 'Same checkpoint. Higher stakes.', 0.78, 6.52, 11.8, 0.29, 19, C.white);
  notes(s, 7);
}

// 8 — Close on an actionable question rather than an investment ask.
{
  const s = newSlide('NOW WHAT / YOUR FIRST COUNTERSIGN', true);
  text(s, "Which action in your application\nneeds a human’s confirmation?", 0.76, 1.39, 9.0, 1.04, 24, C.slate);
  text(s, 'Choose one action.', 0.74, 3.12, 9.0, 0.82, 42, C.white, { bold: true });
  text(s, 'Require a countersign.', 0.74, 4.04, 9.70, 0.83, 42, C.mint, { bold: true });
  ellipse(s, 10.01, 2.54, 2.56, 2.56, C.navy2, '335368');
  icon(s, 'shield', 10.65, 3.04, 1.31, C.mint, C.navy2);
  text(s, 'AI where it helps. Humans where it matters.', 0.79, 6.36, 11.70, 0.34, 19.5, C.white);
  notes(s, 8);
}

assert.equal(slideIndex, 8);
assert.equal(times.reduce((a, b) => a + b, 0), 390);
fs.writeFileSync(path.join(ROOT, 'node_modules/.cache/countersign-deck-layout.json'), JSON.stringify({
  canvas: { width: W, height: H, unit: 'inches' }, font: FONT,
  slides: 8, timed_seconds: times, buffer_seconds: 30, qa_seconds: 180,
  embedded_video: hasDemo, video_sha256: demo?.sha256 ?? null,
  objects: layout,
}, null, 2) + '\n');
pptx.writeFile({ fileName: path.join(__dirname, 'Countersign.pptx'), compression: true });
