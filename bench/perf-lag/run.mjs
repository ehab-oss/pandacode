#!/usr/bin/env node
// Baseline harness for the owner's complaint: the main thread feels laggy while scrolling a
// long transcript and while typing in the composer since the WebGL sky scene shipped, while the
// BTW side panel stays smooth.
//
// It seeds a 200-message thread (markdown, fenced code, tool cards) through the repo's own
// preview mock (src/preview.ts, patched on the wire like tests/*.spec.ts do: no source edits),
// then measures, per repeat:
//   transcript scroll (programmatic) · transcript scroll (real wheel) · composer typing · a streaming run ·
//   BTW scroll · BTW wheel · BTW typing
// in three states, repeated --repeats times and interleaved so machine drift cannot favour one state:
//   on      — the WebGL canvas and the scene's CSS treatments
//   off     — no canvas, no scene CSS (the control)
//   css-off — the canvas still painting, `data-scene` removed (the isolation that names the mechanism)
// The `scrollTop` cells (`mainScroll`, `btwScroll`) and the streamed pin are synthetic: a position assignment arms none of the
// sky's reader listeners, so its hold cannot arm there. Only the wheel cells are real browser input, and only they measure the
// owner's gesture; every cell carries that mark (`kind`) into the JSON and the printed tables.
//
//   node bench/perf-lag/run.mjs                       # 3 states x 2 repeats x 2 rasters
//   node bench/perf-lag/run.mjs --repeats 1           # quicker
//   node bench/perf-lag/run.mjs --port 1437           # another port
//   node bench/perf-lag/run.mjs --dry-run             # provenance + config only, no run
//   node bench/perf-lag/run.mjs --worktree /tmp/pre   # serve another checkout of the same commit
//   node bench/perf-lag/run.mjs --no-server           # reuse a dev server already on --port
//
// Every run records which harness revision and which source tree produced it (`env.harness`,
// `env.commit`, `env.srcTree`), so two JSONs can be shown to come from the same script and the
// same commit. Results: bench/perf-lag/results/baseline.json plus tables on stdout.
import { chromium, webkit } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** repo root, checkout-relative from this script: bench/perf-lag/run.mjs -> ../.. */
const repo = join(here, '..', '..');

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const next = argv[at + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const PORT = Number(arg('port', 1420));
const BASE = `http://127.0.0.1:${PORT}`;
const MESSAGES = Number(arg('messages', 200));
const SCROLL_MS = Number(arg('scroll-ms', 2000));
const SCROLL_SPEED = Number(arg('scroll-speed', 3000)); // px/s, a fast trackpad fling
/** Real wheel input for the `mainWheel` cell: one notch every `--wheel-gap` ms, of at least `--wheel-step` px. At the defaults
 *  the step is the *nominal* 3 000 px/s the `scrollTop` cell assigns (120 px / 40 ms), but a dispatched notch costs a real
 *  browser more than 40 ms, so a fixed step only ever delivers ~2 300 px/s and used to leave this cell ~1 200 px short of the
 *  programmatic one. The driver below therefore ramps its notches to the distance that cell actually travels, over the same
 *  window, and every scroll cell records both its nominal and its measured rate. */
const WHEEL_GAP = Number(arg('wheel-gap', 40));
const WHEEL_STEP = Number(arg('wheel-step', Math.round(SCROLL_SPEED * WHEEL_GAP / 1000)));
/** The largest single notch the ramp may send (a long fling): a driver that fell behind catches up in a few notches instead of
 *  one absurd `deltaY`. 4 x `--wheel-step` at the defaults. */
const WHEEL_MAX_STEP = Number(arg('wheel-max-step', Math.max(WHEEL_STEP, WHEEL_STEP * 4)));
const CHARS = Number(arg('chars', 40));
const TYPE_DELAY = Number(arg('type-delay', 30)); // ms between keystrokes
const REPEATS = Number(arg('repeats', 2));
/** This box also runs the owner's desktop and other agents: wait for the load to fall before a cell. */
const MAX_LOAD = Number(arg('max-load', 2));
const LOAD_WAIT = Number(arg('load-wait', 180));
const BROWSER = String(arg('browser', 'chromium'));
/** `gpu` (default): the machine's real GPU, as the app runs. `software`: force CPU compositing and
 *  raster too, which is what a WebKitGTK window falls back to when its GPU path fails — the owner's
 *  report is reproduced there, and the difference between the two modes is itself the finding. */
const RASTER = String(arg('raster', 'both'));
/** `--scene-css on|off|both` names the treatment the isolation is about; it is accepted for compatibility and
 *  recorded in the JSON, but it does not filter cells: every run measures sky-on, sky-off **and** scene-css-off for
 *  whichever rasters are requested, so a single run always contains the control and the isolation. */
const SCENE_CSS = String(arg('scene-css', arg('no-scene-css', false) ? 'off' : 'both')).toLowerCase();
/** The measured states, in the order they are printed. Never a subset: see SCENE_CSS. */
const STATES = ['on', 'off', 'css-off'];
/** Serve this tree instead of the harness checkout: a second checkout of the same commit (`git archive HEAD` into a
 *  temp dir is enough) so the pre-fix numbers can be regenerated with this exact script. Never writes git state. */
const WORKTREE_RAW = arg('worktree', null);
/** '' means the flag was given without a path: main() rejects it before anything is measured. */
const WORKTREE = WORKTREE_RAW === true ? '' : WORKTREE_RAW;
const SERVE_ROOT = WORKTREE ? resolve(String(WORKTREE)) : repo;
/** The commit the served tree must be: the harness checkout's HEAD unless overridden. */
const EXPECT_COMMIT_RAW = arg('expect-commit', null);
const EXPECT_COMMIT = EXPECT_COMMIT_RAW === true ? '' : EXPECT_COMMIT_RAW;
/** A `git archive` tree has no node_modules; link the harness checkout's one in (untracked, git state untouched). */
const LINK_DEPS = !arg('no-link-deps', false);
/** Print provenance and config, verify the worktree, then stop without starting a browser. */
const DRY_RUN = Boolean(arg('dry-run', false));
const OWN_SERVER = !arg('no-server', false);
const OUT = String(arg('out', join(here, 'results', 'baseline.json')));
const TYPE_TEXT = 'The quick brown fox jumps over the lazy dog.'.slice(0, CHARS);
/** The streaming window: a run that keeps writing while the transcript is pinned to the bottom. */
const STREAM_MS = Number(arg('stream-ms', 2000));
const STREAM_CHUNK = Number(arg('stream-chunk', 24));

// Chromium headless gets the real GPU through ANGLE instead of SwiftShader; the app is a
// WebKitGTK window natively, so software GL would measure the wrong thing.
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-2d-canvas', '--disable-features=CanvasOopRasterization'];

// ---------------------------------------------------------------- seed data
/** Assistant prose: a heading, inline code, a fenced block, a list and a quote. */
function assistantBody(i) {
  return [
    `### Step ${i}: the index is rebuilt on every keystroke`,
    '',
    `The hot path is \`createSearchIndex(items)\` in \`src/lib/search-index-${i}.ts\`; it walks the whole corpus and reallocates a map per call.`,
    '',
    '```ts',
    `export function createSearchIndex${i}(items: Item[]) {`,
    '  const index = new Map<string, Item[]>()',
    '  for (const item of items) {',
    '    const key = item.title.toLowerCase()',
    '    const bucket = index.get(key) ?? []',
    `    bucket.push({ ...item, revision: ${i} })`,
    '    index.set(key, bucket)',
    '  }',
    '  return index',
    '}',
    '```',
    '',
    '- The rebuild runs synchronously on the main thread.',
    '- Every keystroke invalidates the memo and rebuilds again.',
    `- A thread of ${i} turns makes the corpus large enough to notice.`,
    '',
    `> Measured: ~${8 + (i % 7)} ms per rebuild at this size, before any rendering.`,
    '',
    `Try it with \`npm run dev\` and watch the profile for turn ${i}.`,
  ].join('\n');
}

const MARK = [
  'Please check `src/components/search.ts` again — the filter still feels slow.',
  'Now the debounce fires twice on the same frame; is that the queue?',
  'Can you profile the render pass and tell me which selector is expensive?',
  'The scroll hiccup only shows up after a few hundred turns.',
];

/** `count` rows: alternating user prompt / assistant markdown, plus a tool card every 4th turn. */
function buildRows(count) {
  const rows = [];
  let id = 0;
  for (let i = 1; i <= count; i++) {
    rows.push({ id: ++id, role: 'user', content: MARK[i % MARK.length], createdAt: 1_700_000_000_000 + i * 1000 });
    rows.push({ id: ++id, role: 'assistant', content: assistantBody(i), createdAt: 1_700_000_000_000 + i * 1000 + 500 });
    if (i % 4 === 0) {
      rows.push({
        id: ++id, role: 'tool', createdAt: 1_700_000_000_000 + i * 1000 + 700,
        content: JSON.stringify({
          type: 'tool_activity', version: 1, id: `perf-tool-${i}`, name: 'Read', status: 'completed',
          input: `src/lib/search-index-${i}.ts`, output: `Read 128 lines of src/lib/search-index-${i}.ts`,
        }),
      });
    }
  }
  return rows;
}
const ROWS = buildRows(MESSAGES);

// ---------------------------------------------------------------- in-page probes (serialized by Playwright)
/** Runs before any page script: the seeded rows, a long-task buffer and an event-timing buffer. */
function installPerf(payload) {
  window.__perfRows = payload.rows;
  window.__perfTargets = new Set(payload.targets);
  window.__perfFeed = (sessionId, title) => {
    // The open thread, and any BTW side thread the /btw step creates later on.
    if (!window.__perfTargets.has(sessionId) && !(title || '').startsWith('BTW')) return null;
    return payload.rows.map(row => ({ ...row, sessionId }));
  };
  window.__perfLongTasks = [];
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__perfLongTasks.push({ start: entry.startTime, duration: entry.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
  window.__perfEvents = [];
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__perfEvents.push({ name: entry.name, start: entry.startTime, duration: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch { /* no event timing */ }
}

/** Scrolls `selector` at `speed` px/s for `duration` ms in rAF steps, recording every frame gap.
 *  Same shape as tests/diff-perf.spec.ts's scroll(): park, then move the box each frame. */
async function scrollProbe([selector, duration, speed]) {
  const list = document.querySelector(selector);
  if (!list) throw new Error('missing scroller ' + selector);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const max = list.scrollHeight - list.clientHeight;
  list.scrollTop = Math.round(max * 0.1);
  await frame(); await frame();
  const origin = list.scrollTop, span = Math.max(0, Math.min(max - origin, speed * duration / 1000));
  const deltas = [];
  let last = await frame();
  const start = last;
  for (;;) {
    const now = await frame();
    deltas.push(now - last); last = now;
    const progress = Math.min(1, (now - start) / duration);
    list.scrollTop = origin + span * progress;
    if (progress >= 1) break;
  }
  const end = performance.now();
  await frame();
  // The position it started and ended at, and the distance it covered, in the same shape the wheel cell reports: "both cells
  // park at 10 % and travel the same distance" is then checkable from the JSON instead of taken on trust.
  const endTop = list.scrollTop;
  return {
    deltas, start, end, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
    span: Math.round(span), startTop: Math.round(origin), endTop: Math.round(endTop), distancePx: Math.round(endTop - origin),
    maxScrollTop: Math.round(max), windowMs: Math.round(end - start), scrollTop: list.scrollTop,
  };
}

/** Parks `selector` where a reader with history above and below it would sit, and picks the point the wheel is delivered at.
 *  `scrollTop` is used here only to *position* the window — moving the scroller inside the window is the wheel's job.
 *  `slot` names this wheel window, so the transcript (`main`) and the side thread (`btw`) each get their own state instead of
 *  overwriting one global. The point must land on a `.message` (the sky's READABLE list: hovering one leaves the pointer
 *  alone, so the pre-fix sky keeps its idle cadence and the two scroll cells differ in the input and in nothing else) and
 *  inside `scope` — the scroller being measured, `#transcript` or `.btw-transcript` (`src/sky-window.ts`: both are in
 *  `SCROLLERS`), because a point on anything else would measure a different element. Returns at once so Playwright can drive
 *  the wheel. */
async function wheelPark([selector, fraction, slot, scope]) {
  const list = document.querySelector(selector);
  if (!list) throw new Error('missing scroller ' + selector);
  const within = scope ?? selector;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const max = Math.max(0, list.scrollHeight - list.clientHeight);
  list.scrollTop = Math.round(max * fraction);
  await frame(); await frame();
  const rect = list.getBoundingClientRect();
  const candidates = [
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.35 },
    { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.65 },
    { x: rect.left + rect.width * 0.3, y: rect.top + rect.height / 2 },
  ];
  const describe = (element) => (element ? `${element.tagName.toLowerCase()}.${String(element.className || '').split(' ').filter(Boolean).join('.')}` : 'nothing');
  let point = candidates[0], hit = document.elementFromPoint(point.x, point.y), inside = hit?.closest(within) ?? null;
  for (const candidate of candidates) {
    const element = document.elementFromPoint(candidate.x, candidate.y);
    if (element?.closest(within) && element.closest('.message')) { point = candidate; hit = element; inside = element.closest(within); break; }
  }
  window.__perfWheels ??= {};
  window.__perfWheels[slot || 'main'] = {
    slot: slot || 'main', selector, scope: within, point, startTop: list.scrollTop, max,
    scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
    // Provenance for the point itself: a wheel delivered over the composer or an overlay would be a different cell.
    pointHit: describe(hit), pointInsideScroller: Boolean(inside), pointOverMessage: Boolean(hit?.closest?.('.message')),
    deltas: [], tops: [], events: [], start: null, end: null, done: false,
  };
  const state = window.__perfWheels[slot || 'main'];
  return {
    point, startTop: state.startTop, max, scope: within,
    pointHit: state.pointHit, pointInsideScroller: state.pointInsideScroller,
    pointOverMessage: state.pointOverMessage,
    scrollHeight: state.scrollHeight, clientHeight: state.clientHeight,
  };
}

/** Starts the frame recorder for the wheel window and returns immediately, so Playwright can drive `page.mouse.wheel()`
 *  from outside the page: only browser-level input is trusted, and nothing a script dispatches can stand in for it. The
 *  loop records every frame gap and the scroll position each frame until `duration` ms of page time have passed. */
async function wheelArm([slot, duration]) {
  const state = window.__perfWheels?.[slot || 'main'];
  if (!state) throw new Error('wheelPark was not called for slot ' + (slot || 'main'));
  const list = document.querySelector(state.selector);
  if (!list) throw new Error('missing scroller ' + state.selector);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  state.deltas = []; state.tops = []; state.events = [];
  state.top = list.scrollTop; state.peak = list.scrollTop; state.startTop = list.scrollTop;
  state.max = Math.max(0, list.scrollHeight - list.clientHeight);
  // `isTrusted` is kept per event: a wheel a script fabricated would report false here and could not prove the reader.
  state.onWheel = event => state.events.push({ at: performance.now(), deltaY: event.deltaY, deltaMode: event.deltaMode, trusted: event.isTrusted });
  list.addEventListener('wheel', state.onWheel, { capture: true, passive: true });
  state.start = performance.now();
  state.done = false;
  const loop = async () => {
    let last = state.start;
    for (;;) {
      const now = await frame();
      state.deltas.push(now - last); last = now;
      const top = list.scrollTop;
      state.top = top;
      state.tops.push({ at: now, top });
      if (top > state.peak) state.peak = top;
      if (now - state.start >= duration) break;
    }
    state.end = performance.now();
    state.endTop = list.scrollTop;
    state.done = true;
  };
  void loop();
  return { start: state.start, startTop: state.startTop, max: state.max };
}

/** Ends the wheel window and reports what it did: the frame gaps, the trusted wheel events the app's listener saw, and the
 *  distance the transcript actually moved — so a cell whose wheel never scrolled is visible in the JSON, not a silent pass. */
async function wheelStop([slot]) {
  const state = window.__perfWheels?.[slot || 'main'];
  if (!state) throw new Error('no wheel window to stop for slot ' + (slot || 'main'));
  const list = document.querySelector(state.selector);
  if (state.onWheel && list) list.removeEventListener('wheel', state.onWheel, { capture: true });
  const endTop = list ? list.scrollTop : null;
  const trusted = state.events.filter(event => event.trusted);
  return {
    deltas: state.deltas,
    start: state.start, end: state.end,
    startTop: Math.round(state.startTop), endTop: endTop === null ? null : Math.round(endTop), peakTop: Math.round(state.peak),
    maxScrollTop: Math.round(state.max),
    distancePx: Math.round(state.peak - state.startTop), endDistancePx: endTop === null ? null : Math.round(endTop - state.startTop),
    travelPct: state.max > 0 ? Math.round(state.peak / state.max * 1000) / 10 : null,
    scrollHeight: list ? list.scrollHeight : null, clientHeight: list ? list.clientHeight : null,
    slot: state.slot || 'main', scope: state.scope || state.selector,
    ticks: state.events.length, trustedTicks: trusted.length,
    wheelDeltaPx: Math.round(state.events.reduce((sum, event) => sum + Math.abs(event.deltaY), 0)),
    deltaModes: [...new Set(state.events.map(event => event.deltaMode))].sort(),
    firstTicks: state.events.slice(0, 3).map(event => Math.round(event.deltaY)),
    // Did the wheel move it, and where did it end: at the top, at the bottom, or somewhere a reader would be.
    scrolled: state.peak - state.startTop > 100,
    atTop: endTop !== null && endTop <= 1, nearBottom: endTop !== null && endTop >= state.max - 8,
    windowMs: state.end === null ? null : Math.round(state.end - state.start),
    frames: state.deltas.length,
  };
}

/** A streaming run: `data-running` on the transcript, a reply that keeps growing every frame, and the app's own pin
 *  to the bottom on every frame. That pin assigns `scrollTop`, which fires none of the events the hold is armed by in
 *  src/sky-window.ts (`wheel`, `touchmove`, `pointerdown`, `keydown`, `input`), so the hold must not arm on it. Records the
 *  frame gaps for `duration` ms; the contract is that a run keeps its wind, so the sky must keep painting here. */
async function streamProbe([duration, chunk]) {
  const list = document.querySelector('#transcript');
  if (!list) throw new Error('missing #transcript');
  const layer = document.querySelector('.thread-sky');
  const row = document.createElement('div');
  row.id = '__perfStreamRow';
  row.className = 'message assistant';
  row.innerHTML = '<div class="message-body"><p></p></div>';
  list.append(row);
  const body = row.querySelector('p');
  // A text node grown in place: rebuilding the whole text each frame re-parses HTML and invalidates every selector in the
  // transcript, which would measure the probe instead of the run.
  const textNode = document.createTextNode('');
  body.append(textNode);
  const text = 'The run is still writing; every token lands on the main thread. ';
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const hadRunning = list.hasAttribute('data-running');
  list.setAttribute('data-running', '');
  const deltas = [];
  let chars = 0, gap = null, pinned = 0;
  let last = await frame();
  const start = last;
  for (;;) {
    const now = await frame();
    deltas.push(now - last); last = now;
    textNode.appendData(text.slice(0, chunk));
    chars += chunk;
    // main.ts pins the transcript to the bottom on every streamed frame instead of asking the reader where to stay.
    list.scrollTop = list.scrollHeight;
    gap = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (gap <= 32) pinned++;
    if (now - start >= duration) break;
  }
  const end = performance.now();
  const result = {
    deltas, start, end, gap, pinned, frames: deltas.length, chars,
    running: list.hasAttribute('data-running'), wind: layer?.dataset.wind ?? null, skyState: layer?.dataset.skyState ?? null,
    scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
  };
  row.remove();
  if (!hadRunning) list.removeAttribute('data-running');
  await frame();
  return result;
}

/** Focuses the composer and records, per input event, the time to the next animation frame (the
 *  frame that paints the character). Typing itself is driven from Playwright as real key events. */
async function typeStart(selector) {
  const field = document.querySelector(selector);
  if (!field) throw new Error('missing composer ' + selector);
  field.focus();
  window.__perfType = { selector, samples: [], inputs: 0, focused: document.activeElement === field, valueLength: field.value.length };
  window.__perfTypeOnInput = () => {
    const t = performance.now();
    window.__perfType.inputs++;
    // performance.now() inside the frame callback, not the frame's start timestamp: that timestamp can
    // predate the input event and would report a negative latency.
    requestAnimationFrame(() => { const frame = performance.now(); window.__perfType.samples.push({ input: t, frame, latency: frame - t }); });
  };
  field.addEventListener('input', window.__perfTypeOnInput, true);
  window.__perfTypeStart = performance.now();
  return { focused: window.__perfType.focused, valueLength: window.__perfType.valueLength };
}

async function typeStop() {
  const field = document.querySelector(window.__perfType.selector);
  if (field && window.__perfTypeOnInput) field.removeEventListener('input', window.__perfTypeOnInput, true);
  window.__perfTypeEnd = performance.now();
  const samples = window.__perfType.samples.slice();
  return { samples, inputs: window.__perfType.inputs, start: window.__perfTypeStart, end: window.__perfTypeEnd, valueLength: field ? field.value.length : null };
}

/** Frame count and paint cost the sky reports, plus the WebGL renderer behind it. */
async function skyState() {
  const layer = document.querySelector('.thread-sky');
  const canvas = layer && layer.querySelector('canvas');
  let renderer = null;
  if (canvas) {
    const gl = canvas.getContext('webgl');
    if (gl) { const info = gl.getExtension('WEBGL_debug_renderer_info'); renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER); }
  }
  const sky = window.__sky ?? {};
  return {
    hidden: layer ? layer.hasAttribute('hidden') : null,
    gl: layer ? layer.hasAttribute('data-gl') : null,
    state: layer ? layer.getAttribute('data-sky-state') : null,
    scene: sky.scene ?? null, timing: sky.timing ?? null, scale: sky.scale ?? null,
    frames: sky.frames ?? null, gpuMs: typeof sky.gpuMs === 'number' ? Math.round(sky.gpuMs * 100) / 100 : null,
    renderer,
  };
}

/** Counts seeded rows the renderer actually drew. */
async function counts() {
  return {
    transcriptMessages: document.querySelectorAll('#transcript .message').length,
    transcriptRows: document.querySelectorAll('#transcript>*').length,
    btwRows: document.querySelectorAll('.btw-transcript [data-message-id]').length,
    transcriptScrollHeight: document.querySelector('#transcript')?.scrollHeight ?? null,
    btwScrollHeight: document.querySelector('.btw-transcript')?.scrollHeight ?? null,
  };
}

// ---------------------------------------------------------------- stats
const round = value => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
/** Frame pacing. `over25`/`over33`/`over34`/`over50` count frame intervals past those thresholds: 33.4 ms is *two* vsyncs at
 *  60 Hz, so `over33` is the smoothness headline (a cell that drops every other frame still shows a p95 near 17 ms while
 *  `over33` names it). `over34` is kept so an older JSON's field still means what it did. */
function frameStats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    frames: deltas.length,
    p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)),
    max: round(sorted.at(-1)),
    over25: deltas.filter(delta => delta > 25).length, over33: deltas.filter(delta => delta > 33).length,
    over34: deltas.filter(delta => delta > 34).length, over50: deltas.filter(delta => delta > 50).length,
    meanFps: round(deltas.length ? 1000 / (deltas.reduce((sum, d) => sum + d, 0) / deltas.length) : null),
  };
}
function latencyStats(samples) {
  const values = samples.map(sample => sample.latency).sort((a, b) => a - b);
  return {
    keystrokes: values.length,
    p50: round(percentile(values, 0.5)), p95: round(percentile(values, 0.95)), max: round(values.at(-1) ?? null),
    // The same thresholds the frame cells report, applied to how long each keystroke took to reach a painted frame.
    over25: values.filter(value => value > 25).length, over33: values.filter(value => value > 33).length,
    over34: values.filter(value => value > 34).length, over100: values.filter(value => value > 100).length,
  };
}
const longTasksBetween = (tasks, start, end) => {
  const hits = tasks.filter(task => task.start >= start && task.start < end);
  const sorted = hits.map(task => task.duration).sort((a, b) => a - b);
  return { count: hits.length, totalMs: round(hits.reduce((sum, task) => sum + task.duration, 0)), max: round(sorted.at(-1) ?? null) };
};
/** Event Timing inside a wheel window. There is no `wheel` entry type — Chromium reports `pointerdown`/`pointerup`/`click`/
 *  `keydown`/`input`/… but never `wheel` — so this cannot count wheel latency at all: a `slowWheel` count was structurally 0
 *  even when the wheel cell dropped 12 frames, and the observer only reports entries at or above 16 ms. What remains is
 *  `slowEventsAll`: *every* input entry in the window, hover and pointer churn under a parked cursor included. It is not wheel
 *  latency and is labelled as such (`slowEventsAllKind`); the wheel window's pacing is in `frameStats(wheel.deltas)` beside it
 *  (`over25`/`over33`/`over34`), and the trusted tick count is the arrival proof. `eventTypes` is the evidence that no `wheel`
 *  entry exists to count. */
const wheelEventStats = (events, start, end) => {
  const hits = events.filter(event => event.start >= start && event.start < end);
  const worst = round(hits.reduce((top, event) => Math.max(top, event.duration), 0) || null);
  return {
    slowEventsAll: hits.length, slowEventsAllMaxMs: worst,
    slowEventsAllKind: 'input events of any type (hover/pointer/keydown churn under a parked cursor), not wheel latency',
    eventTypes: [...new Set(hits.map(event => event.name))].sort().join(','),
  };
};
/** Event Timing entries for the keystrokes in [start, end): the observer only reports entries at or above 16 ms.
 *  `duration` runs from the keypress until the rendering update it caused has been presented, so — unlike `latency`,
 *  which starts at the `input` event — it includes input dispatch and the work before the event reaches the field.
 *  That is why it moves between sky-on and sky-off while p95 keystroke latency does not. */
const eventStats = (events, start, end, keystrokes) => {
  const hits = events.filter(event => event.name === 'input' && event.start >= start && event.start < end);
  return {
    slowEvents: hits.length,
    slowShare: round(keystrokes ? hits.length / keystrokes : null),
    slowMaxMs: round(hits.reduce((max, event) => Math.max(max, event.duration), 0) || null),
  };
};

// ---------------------------------------------------------------- provenance (which script, which tree)
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitRun = (cwd, args, gitDir) => spawnSync('git', gitDir ? [`--git-dir=${gitDir}`, `--work-tree=${cwd}`, ...args] : args,
  { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const gitText = (cwd, args, gitDir) => {
  const result = gitRun(cwd, args, gitDir);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} in ${cwd} failed (exit ${result.status}): ${(result.stderr || '').trim().slice(0, 500)}`);
  }
  return result.stdout.trim();
};
/** The repo whose `.git` *is* this directory — never a parent's: a tree extracted under /tmp must not be judged through
 *  whatever repository /tmp happens to sit in. null when the directory has no repository of its own. */
function ownRepoRoot(dir) {
  try {
    const top = gitText(dir, ['rev-parse', '--show-toplevel']);
    return realpathSync(top) === realpathSync(dir) ? top : null;
  } catch { return null; }
}
/** A `git archive` tree has no node_modules; the app's bare imports resolve through one. Symlinked, logged, and the
 *  worktree's git state (index, HEAD, refs) is never touched — the link is an untracked, gitignored directory. */
function ensureDeps(root) {
  if (root === repo) return 'own';
  if (existsSync(join(root, 'node_modules'))) return 'present';
  if (!LINK_DEPS) throw new Error(`--worktree ${root} has no node_modules and --no-link-deps was given: link ${join(repo, 'node_modules')} there yourself`);
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
  console.log(`NOTE: linked ${join(repo, 'node_modules')} -> ${join(root, 'node_modules')} (untracked; the worktree's git state is untouched)`);
  return 'linked';
}

/** Who measured whom. `harness` pins the script, `commit` + `srcTree` pin the tree it served, so a pre-fix and a
 *  post-fix JSON produced by different script revisions can never be compared as if they were one experiment. */
function provenance() {
  const harnessPath = fileURLToPath(import.meta.url);
  const selfRepo = ownRepoRoot(repo);
  if (!selfRepo) throw new Error(`${repo} is not the root of a git repository: the harness cannot record which source tree it measured`);
  const commit = gitText(selfRepo, ['rev-parse', 'HEAD']);
  const expected = EXPECT_COMMIT ?? commit;
  const root = SERVE_ROOT;
  if (!existsSync(join(root, 'src', 'main.ts'))) {
    throw new Error(`${root} has no src/main.ts: --worktree must point at a checkout (or "git archive HEAD" tree) of ${expected}`);
  }
  const own = ownRepoRoot(root);
  let verifiedBy, servedCommit = null;
  if (own) {
    servedCommit = gitText(own, ['rev-parse', 'HEAD']);
    if (servedCommit !== expected) {
      throw new Error(`--worktree ${root} is at commit ${servedCommit}, expected ${expected}. The before/after pair must be the same commit.`);
    }
    verifiedBy = 'git rev-parse HEAD in the served tree';
  } else {
    // No repository of its own (`git archive HEAD | tar -x`): prove the files equal the expected commit's tree. Reads
    // the harness checkout's .git; writes nothing into the served tree.
    const gitDir = join(selfRepo, '.git');
    const check = gitRun(root, ['diff', '--quiet', expected, '--'], gitDir);
    if (check.status === 1) {
      const files = gitText(root, ['diff', '--name-only', expected, '--'], gitDir).split('\n').filter(Boolean);
      throw new Error(`${root} differs from commit ${expected} (${files.length ? files.join(', ') : 'unknown files'}): extract \`git archive ${expected}\` again, do not measure a drifted tree`);
    }
    if (check.status !== 0) {
      throw new Error(`${root} has no .git and could not be checked against ${expected}: ${(check.stderr || '').trim().slice(0, 500)}`);
    }
    verifiedBy = `git --git-dir=${gitDir} --work-tree=${root} diff --quiet ${expected} (content equals the commit)`;
  }
  // The tracked tree as served: the uncommitted diff against the commit, hashed. Empty for a clean tree.
  const gitDir = own ? join(own, '.git') : join(selfRepo, '.git');
  const diffText = gitText(root, ['diff', '--no-color', '--no-ext-diff', expected, '--'], gitDir);
  const files = gitText(root, ['diff', '--name-only', expected, '--'], gitDir).split('\n').filter(Boolean);
  const stat = gitText(root, ['diff', '--shortstat', expected, '--'], gitDir);
  const harness = sha256(readFileSync(harnessPath));
  const nodeModules = ensureDeps(root);
  return {
    harness, harnessPath, commit, expectedCommit: expected, servedCommit,
    srcTree: { sha256: sha256(diffText), files, stat, clean: diffText === '', bytes: Buffer.byteLength(diffText) },
    worktree: {
      path: root, source: root === selfRepo ? 'harness checkout' : '--worktree', hasGit: Boolean(own),
      commit: servedCommit, verifiedBy, nodeModules,
    },
  };
}

function printProvenance(prov) {
  console.log('provenance (also written to the JSON "env" block)');
  console.log(`  harness  ${prov.harness}  run.mjs`);
  console.log(`  commit   ${prov.commit}  (served tree expected at this commit)`);
  console.log(`  srcTree  ${prov.srcTree.sha256}  ${prov.srcTree.clean
    ? 'clean: the served tracked tree equals the commit'
    : `${prov.srcTree.files.length} file(s) modified: ${prov.srcTree.files.join(', ')} [${prov.srcTree.stat}]`}`);
  console.log(`  served   ${prov.worktree.path} (${prov.worktree.source}; ${prov.worktree.verifiedBy}; node_modules ${prov.worktree.nodeModules})`);
  console.log(`  raster   ${RASTER}, browser ${BROWSER}; gpu: ${LAUNCH_ARGS.join(' ')}; software: ${SOFTWARE_ARGS.join(' ')}`);
  console.log(`  states   ${STATES.join(' / ')} x ${REPEATS} repeat(s) per raster; scene-css ${SCENE_CSS}`);
}

// ---------------------------------------------------------------- dev server
const alive = async () => { try { const response = await fetch(`${BASE}/`); return response.ok; } catch { return false; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureServer() {
  if (await alive()) {
    if (SERVE_ROOT !== repo) console.warn(`WARNING: reusing the dev server on ${BASE}; it may not be serving --worktree ${SERVE_ROOT}. Drop --no-server to start one there.`);
    return { child: null, reused: true };
  }
  if (!OWN_SERVER) throw new Error(`No dev server on ${BASE}. Run "npm run dev" in ${SERVE_ROOT} first.`);
  const vite = join(repo, 'node_modules', '.bin', 'vite');
  if (!existsSync(vite)) throw new Error(`vite not found at ${vite}: run "npm install" in ${repo} first`);
  const child = spawn(vite, ['--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: SERVE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  for (let i = 0; i < 240; i++) {
    await wait(500);
    if (await alive()) return { child, reused: false };
    if (child.exitCode !== null) throw new Error(`vite exited (${child.exitCode}):\n${log.slice(-4000)}`);
  }
  child.kill('SIGTERM');
  throw new Error(`vite never answered on ${BASE}:\n${log.slice(-4000)}`);
}

// ---------------------------------------------------------------- wire patches (the repo's own preview fixtures)
const PREVIEW_MARKER = /switch\s*\(command\)\s*\{/;
function patchPreview(source) {
  if (!PREVIEW_MARKER.test(source)) throw new Error('src/preview.ts no longer matches "switch (command) {"');
  return source.replace(PREVIEW_MARKER, `(window.__perfCalls ??= []).push({ command, args: structuredClone(args) });
      if (command === 'get_messages' && window.__perfFeed) { const rows = window.__perfFeed(args.sessionId, session(args.sessionId)?.title); if (rows) return { messages: rows, hasOlder: false }; }
      switch (command) {`);
}
const MAIN_MARKER = 'wanted: () => !wallpapers.preferences.enabled';
function patchMain(source) {
  if (!source.includes(MAIN_MARKER)) throw new Error('src/main.ts no longer has "' + MAIN_MARKER + '"');
  // `--sky-off` clears the layer before mount: no WebGL context, no paint loop, no gradient wash.
  return source.split(MAIN_MARKER).join('wanted: () => !window.__perfSkyOff && !wallpapers.preferences.enabled');
}

// ---------------------------------------------------------------- one measured cell
/** What drives each cell, and what it therefore proves. A `scrollTop` assignment is a position write: it fires no event and
 *  arms none of the sky's reader listeners (`wheel`, `touchmove`, `pointerdown`, `keydown`, `input` in src/sky-window.ts), so
 *  the 150 ms hold cannot arm on it — a synthetic cell says nothing about the owner's gesture. Only the wheel cells carry
 *  trusted browser input (`page.mouse.wheel`), and the typing cells trusted key events. The mark is carried into every cell
 *  record, into the summary (`summary.<state>.<cell>.kind`) and into the printed tables, so no document can read the synthetic
 *  row as the reader's own scroll. */
const CELL_KIND = {
  mainScroll: 'synthetic', mainWheel: 'reader', mainTyping: 'reader', mainStream: 'app',
  btwScroll: 'synthetic', btwWheel: 'reader', btwTyping: 'reader',
};
const CELL_LABEL = {
  mainScroll: 'SYNTHETIC: #transcript scrolled by assigning scrollTop per frame — no reader event, so the sky\'s hold cannot arm',
  mainWheel: 'REAL reader input: page.mouse.wheel over #transcript (trusted wheel events)',
  mainTyping: 'REAL reader input: 40 key events in #prompt',
  mainStream: 'APP-driven: the app pins scrollTop on every streamed frame — no reader event, so the hold cannot arm',
  btwScroll: 'SYNTHETIC: .btw-transcript scrolled by assigning scrollTop per frame — no reader event, so the hold cannot arm',
  btwWheel: 'REAL reader input: page.mouse.wheel over the side thread\'s .btw-transcript (trusted wheel events)',
  btwTyping: 'REAL reader input: 40 key events in .btw-input',
};
/** A cell record plus the sky's state at the end of its window. `skyScale`/`skyGpuMs` repeat the two fields of `sky` at the
 *  top of the record so the render scale is visible without walking into the probe's object — the governor's 0.6 -> 0.45 drop
 *  has to be readable beside the frames it was paid for. */
const withSky = (record, sky) => ({ ...record, sky, skyScale: typeof sky?.scale === 'number' ? sky.scale : null, skyGpuMs: typeof sky?.gpuMs === 'number' ? sky.gpuMs : null });
/** Drives one wheel window from the browser: a notch every `WHEEL_GAP` ms for `SCROLL_MS`, ramped to `targetPx` on the same
 *  linear progress the programmatic cell assigns per frame, stopping once that distance is delivered (a notch is at most
 *  `WHEEL_MAX_STEP`). Returns the notches it dispatched and the pixels it asked for, beside the page's own trusted-event count. */
async function driveWheel(page, targetPx) {
  const driveStart = Date.now();
  let driverTicks = 0, deliveredPx = 0;
  for (;;) {
    const elapsed = Date.now() - driveStart;
    if (elapsed >= SCROLL_MS) break;
    const duePx = Math.round(targetPx * Math.min(1, elapsed / SCROLL_MS));
    const stepPx = Math.min(WHEEL_MAX_STEP, duePx - deliveredPx);
    if (stepPx >= 1) {
      await page.mouse.wheel(0, stepPx);
      deliveredPx += stepPx;
      driverTicks++;
      if (deliveredPx >= targetPx) break; // the distance is delivered: stop rather than overshoot
    }
    await page.waitForTimeout(WHEEL_GAP);
  }
  return { driverTicks, deliveredPx };
}
/** Waits for a wheel window to close, and on timeout says which slot hung and what its state was — a bare 20 s
 *  `waitForFunction` timeout used to be the least informative failure this harness could produce. */
async function waitWheelWindow(page, slot) {
  try {
    await page.waitForFunction(which => window.__perfWheels?.[which]?.done === true, slot, { timeout: 20_000 });
  } catch {
    const state = await page.evaluate(which => {
      const wheels = window.__perfWheels ?? {};
      const s = wheels[which];
      if (!s) return { missing: which, slots: Object.keys(wheels) };
      return {
        slot: s.slot, selector: s.selector, scope: s.scope, done: s.done, start: s.start, end: s.end,
        deltas: s.deltas?.length ?? null, events: s.events?.length ?? null, top: s.top, startTop: s.startTop,
        slots: Object.keys(wheels),
      };
    }, slot).catch(error => ({ evaluateFailed: String(error).slice(0, 300) }));
    throw new Error(`the ${slot} wheel window never finished its ${SCROLL_MS} ms loop: ${JSON.stringify(state)}`);
  }
}
async function measureCell(browser, state, repeat, pageErrors) {
  const skyOn = state !== 'off';
  const sceneCssOff = state === 'css-off';
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // Chromium's own main-thread accounting: on a fast machine every frame interval is 16.7 ms, so
  // how much of each window the renderer's main thread was busy is the sharper signal.
  const cdp = BROWSER === 'chromium' ? await context.newCDPSession(page) : null;
  if (cdp) await cdp.send('Performance.enable');
  const metrics = async () => (cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(entry => [entry.name, entry.value])) : {});
  const metricDelta = (before, after) => {
    if (!cdp) return null;
    const pick = name => (after[name] ?? 0) - (before[name] ?? 0);
    const windowMs = pick('Timestamp') * 1000;
    const taskMs = pick('TaskDuration') * 1000;
    const scriptMs = pick('ScriptDuration') * 1000, layoutMs = pick('LayoutDuration') * 1000, styleMs = pick('RecalcStyleDuration') * 1000;
    return { windowMs: round(windowMs), taskMs: round(taskMs), busyPct: round(windowMs > 0 ? taskMs / windowMs * 100 : null),
      scriptMs: round(scriptMs), layoutMs: round(layoutMs), styleMs: round(styleMs), paintMs: round(taskMs - scriptMs - layoutMs - styleMs) };
  };
  const errors = [];
  page.on('pageerror', error => { if (!error.message.startsWith('ResizeObserver loop')) errors.push(error.message); });
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.addInitScript(installPerf, { rows: ROWS, targets: ['session-1'] });
  await page.addInitScript(value => { window.__perfSkyOff = value; }, !skyOn);
  await page.route('**/src/preview.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: patchPreview(await response.text()) });
  });
  if (!skyOn) {
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: patchMain(await response.text()) });
    });
  }

  // A cell is only comparable on a quiet machine; interference adds main-thread work to both states
  // but not evenly, so wait (bounded) for the 1-minute load to come down first.
  for (let waited = 0; loadavg()[0] > MAX_LOAD && waited < LOAD_WAIT; waited += 2) await wait(2_000);
  const cell = { sky: skyOn ? 'on' : 'off', state, repeat, errors, loadavg: loadavg().map(value => Math.round(value * 100) / 100), measuredAt: new Date().toISOString() };
  /** The `css-off` state: the canvas keeps painting, `data-scene` — the sky's CSS treatments on the transcript and the
   *  composer — is removed. Re-applied before every window, because a re-render would put it back. */
  const sceneCssState = async () => {
    if (sceneCssOff) await page.evaluate(() => document.querySelector('.workspace')?.removeAttribute('data-scene'));
    return page.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-scene') ?? null);
  };
  await page.goto(`${BASE}/?sky=12:00&scene=sky`);
  await page.waitForSelector('#transcript .message', { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('#transcript .message').length > 100, null, { timeout: 60_000 });
  // Let the first markdown paint, the tool cards and the sky's precompile settle.
  await page.waitForTimeout(1500);
  cell.skyBefore = await page.evaluate(skyState);
  cell.counts = await page.evaluate(counts);
  cell.skyFramesIdle = await (async () => {
    const before = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
    return before === null || after === null ? null : after - before;
  })();

  cell.sceneCss = await sceneCssState();

  // One short pass first: the seeded thread's markdown paints on its first visit, which is a
  // load cost, not the scroll cost the owner reports.
  await page.evaluate(scrollProbe, ['#transcript', 600, SCROLL_SPEED]);
  await page.waitForTimeout(300);

  // --- main thread scroll. **Synthetic**: a `scrollTop` assignment, which fires no event at all, so the hold — armed in
  // src/sky-window.ts by reader *events* (`wheel`, `touchmove`, `pointerdown`, `keydown`, `input`) and by nothing else — can
  // never arm here. This cell is the app's own scrolling, not the owner's gesture; `mainWheel` below is the gesture.
  const mainSceneCss = await sceneCssState();
  const skyFramesBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const mainScrollBefore = await metrics();
  const scrollProbeResult = await page.evaluate(scrollProbe, ['#transcript', SCROLL_MS, SCROLL_SPEED]);
  const mainScrollAfter = await metrics();
  const skyFramesAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const longTasks = await page.evaluate(() => window.__perfLongTasks);
  const mainScrollWindowMs = scrollProbeResult.windowMs ?? SCROLL_MS;
  cell.mainScroll = withSky({
    kind: CELL_KIND.mainScroll,
    ...frameStats(scrollProbeResult.deltas),
    longTasks: longTasksBetween(longTasks, scrollProbeResult.start, scrollProbeResult.end),
    scrollHeight: scrollProbeResult.scrollHeight, clientHeight: scrollProbeResult.clientHeight, span: scrollProbeResult.span,
    // Where it started and ended plus what it actually covered: the same shape the wheel cell reports, so "both cells park at
    // 10 % of the scroller and travel the same distance" can be checked from the JSON.
    startTop: scrollProbeResult.startTop, endTop: scrollProbeResult.endTop, distancePx: scrollProbeResult.distancePx,
    maxScrollTop: scrollProbeResult.maxScrollTop, windowMs: mainScrollWindowMs,
    // Nominal is what the harness asked for; achieved is what it measured (distancePx / windowMs). No cell reports only the
    // first, which is how `config.wheelSpeedPxPerSec: 3000` came to be read as an achievement.
    nominalPxPerSec: SCROLL_SPEED,
    achievedPxPerSec: round(mainScrollWindowMs ? scrollProbeResult.distancePx / mainScrollWindowMs * 1000 : null),
    skyFramesDelta: skyFramesBefore === null || skyFramesAfter === null ? null : skyFramesAfter - skyFramesBefore,
    sceneCss: mainSceneCss,
    mainThread: metricDelta(mainScrollBefore, mainScrollAfter),
  }, await page.evaluate(skyState));

  // --- the reader's own scroll: trusted wheel events over the transcript. `mainScroll` assigns `scrollTop`, which fires no
  // event at all, so the hold — armed in src/sky-window.ts by reader *events* (`wheel`, `touchmove`, `pointerdown`, `keydown`,
  // `input`) and by nothing else — can never arm there; this cell is the interaction the owner reported (a wheel over the
  // transcript) and the only one that can show what the hold does to a scroll.
  const wheelSceneCss = await sceneCssState();
  const park = await page.evaluate(wheelPark, ['#transcript', 0.1, 'main', '#transcript']);
  if (!park.pointInsideScroller) throw new Error(`the wheel window would land on ${park.pointHit}, not inside #transcript`);
  await page.mouse.move(park.point.x, park.point.y);
  await page.waitForTimeout(120);
  const wheelFramesBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const wheelBefore = await metrics();
  await page.evaluate(wheelArm, ['main', SCROLL_MS]);
  // The wheel is dispatched from the browser (`driveWheel`), one notch every WHEEL_GAP ms for the same SCROLL_MS window the
  // `scrollTop` cell uses. The notches ramp to the distance that cell actually travelled (`scrollProbeResult.span`), following
  // the same linear progress it assigns per frame, and stop once the distance is delivered: a fixed notch every 40 ms delivers
  // fewer than 50 notches in 2 s (each dispatch costs more than the gap), which is how this cell used to fall ~1 200 px short of
  // the programmatic one while `config` claimed one speed for both. The last ramp point falls just inside the deadline, so the
  // cell typically ends 1-2 % short of the target — that residual is what `distanceVsProgrammatic` records, not a number the
  // config asserts.
  const wheelTargetPx = Math.max(1, Math.round(scrollProbeResult.span));
  const { driverTicks, deliveredPx } = await driveWheel(page, wheelTargetPx);
  await waitWheelWindow(page, 'main');
  const wheelAfter = await metrics();
  const wheelFramesAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const wheel = await page.evaluate(wheelStop, ['main']);
  // Measured, not asserted: distancePx over the window the page actually recorded, against the nominal step/gap intent.
  const wheelWindowMs = wheel.windowMs ?? SCROLL_MS;
  const wheelNominal = Math.round(WHEEL_STEP / WHEEL_GAP * 1000);
  const wheelAchieved = round(wheelWindowMs ? wheel.distancePx / wheelWindowMs * 1000 : null);
  const wheelVsScroll = round(scrollProbeResult.distancePx ? wheel.distancePx / scrollProbeResult.distancePx : null);
  if (wheelVsScroll !== null && wheelVsScroll < 0.9) {
    console.warn(`WARNING: the wheel cell travelled ${wheel.distancePx}px, ${Math.round(wheelVsScroll * 100)}% of the programmatic cell's ${scrollProbeResult.distancePx}px: the two scroll cells are not comparable in this run`);
  }
  const longTasksWheel = await page.evaluate(() => window.__perfLongTasks);
  const wheelTiming = await page.evaluate(() => window.__perfEvents);
  if (!wheel.trustedTicks) throw new Error('the wheel window received no trusted wheel event over #transcript');
  // The hold is 150 ms past the last reader event, not a stop: leave the transcript and prove frames come back.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(250);
  const resumeBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  await page.waitForTimeout(1000);
  const resumeAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  cell.mainWheel = withSky({
    kind: CELL_KIND.mainWheel,
    ...frameStats(wheel.deltas),
    longTasks: longTasksBetween(longTasksWheel, wheel.start, wheel.end),
    ...wheelEventStats(wheelTiming, wheel.start, wheel.end),
    sceneCss: wheelSceneCss,
    mainThread: metricDelta(wheelBefore, wheelAfter),
    skyFramesDelta: wheelFramesBefore === null || wheelFramesAfter === null ? null : wheelFramesAfter - wheelFramesBefore,
    // Frames painted in the second after the reader stopped: a hold must not be a stop.
    resumeFrames: resumeBefore === null || resumeAfter === null ? null : resumeAfter - resumeBefore,
    wheelTicks: wheel.ticks, trustedTicks: wheel.trustedTicks, driverTicks, wheelDeltaPx: wheel.wheelDeltaPx,
    deltaModes: wheel.deltaModes.join('/'), firstTicks: wheel.firstTicks.join('/'),
    startTop: wheel.startTop, endTop: wheel.endTop, peakTop: wheel.peakTop, maxScrollTop: wheel.maxScrollTop,
    distancePx: wheel.distancePx, endDistancePx: wheel.endDistancePx, travelPct: wheel.travelPct,
    // Nominal vs achieved, and the ramp that delivered it: a reader can never take the intent for the measurement again.
    nominalPxPerSec: wheelNominal, achievedPxPerSec: wheelAchieved,
    targetDistancePx: wheelTargetPx, deliveredPx, distanceVsProgrammatic: wheelVsScroll,
    scrolled: wheel.scrolled, atTop: wheel.atTop, nearBottom: wheel.nearBottom,
    scrollHeight: wheel.scrollHeight, clientHeight: wheel.clientHeight, windowMs: wheelWindowMs,
    point: `${Math.round(park.point.x)},${Math.round(park.point.y)}`, pointHit: park.pointHit, pointOverMessage: park.pointOverMessage,
  }, await page.evaluate(skyState));

  // --- main composer typing
  const typeSceneCss = await sceneCssState();
  const focus = await page.evaluate(typeStart, '#prompt');
  if (!focus.focused) throw new Error('the composer did not take focus');
  const mainTypeBefore = await metrics();
  await page.keyboard.type(TYPE_TEXT, { delay: TYPE_DELAY });
  const typed = await page.evaluate(typeStop);
  const mainTypeAfter = await metrics();
  const longTasksAfterTyping = await page.evaluate(() => window.__perfLongTasks);
  const allEvents = await page.evaluate(() => window.__perfEvents);
  cell.mainTyping = withSky({
    kind: CELL_KIND.mainTyping,
    ...latencyStats(typed.samples),
    ...eventStats(allEvents, typed.start, typed.end, typed.samples.length),
    inputs: typed.inputs, chars: TYPE_TEXT.length, valueLength: typed.valueLength,
    longTasks: longTasksBetween(longTasksAfterTyping, typed.start, typed.end),
    sceneCss: typeSceneCss,
    mainThread: metricDelta(mainTypeBefore, mainTypeAfter),
  }, await page.evaluate(skyState));
  await page.evaluate(() => { const field = document.querySelector('#prompt'); if (field) field.value = ''; });

  // --- a streaming run: the transcript in `data-running`, the app pinning to the bottom on every streamed frame. That pin
  // assigns `scrollTop`, which fires none of the hold's reader events (`wheel`, `touchmove`, `pointerdown`, `keydown`,
  // `input`), so the hold must not arm on it and the run must keep its wind: report its frames and pacing.
  const streamSceneCss = await sceneCssState();
  const streamFramesBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const streamBefore = await metrics();
  const stream = await page.evaluate(streamProbe, [STREAM_MS, STREAM_CHUNK]);
  const streamAfter = await metrics();
  const streamFramesAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const longTasksStream = await page.evaluate(() => window.__perfLongTasks);
  if (!stream.running) throw new Error('the streaming cell lost data-running on #transcript');
  // The streamed payload is not constant between runs: the reply grows once per painted frame, so a faster machine streams
  // more chars (54 frames / 1 308 chars one run, 72 / 1 728 the next) and its raw busy % rises for having done more work —
  // which reads as a regression. The raw numbers stay; the normalized fields beside them are what two runs may be compared
  // on (`busyPctPer1kChars` is the field the summary tables use).
  const streamThread = metricDelta(streamBefore, streamAfter);
  cell.mainStream = withSky({
    kind: CELL_KIND.mainStream,
    ...frameStats(stream.deltas),
    longTasks: longTasksBetween(longTasksStream, stream.start, stream.end),
    skyFramesDelta: streamFramesBefore === null || streamFramesAfter === null ? null : streamFramesAfter - streamFramesBefore,
    running: stream.running, wind: stream.wind, skyState: stream.skyState,
    pinnedFrames: stream.pinned, bottomGapPx: stream.gap, streamedChars: stream.chars, streamedFrames: stream.frames,
    charsPerFrame: round(stream.frames ? stream.chars / stream.frames : null),
    // Main-thread busy per streamed frame, and per 1 000 streamed chars: same payload, same number, any run.
    busyPctPerFrame: round(streamThread && stream.frames ? streamThread.busyPct / stream.frames : null),
    busyPctPer1kChars: round(streamThread && stream.chars ? streamThread.busyPct / stream.chars * 1000 : null),
    taskMsPerFrame: round(streamThread && stream.frames ? streamThread.taskMs / stream.frames : null),
    taskMsPer1kChars: round(streamThread && stream.chars ? streamThread.taskMs / stream.chars * 1000 : null),
    sceneCss: streamSceneCss,
    mainThread: streamThread,
  }, await page.evaluate(skyState));

  // --- the BTW side panel: same 200 rows, its own scroller and composer.
  // The /btw send must be the cell's first send_message, so the call log below identifies the side thread.
  const sendsBefore = await page.evaluate(() => (window.__perfCalls ?? []).filter(call => call.command === 'send_message').length);
  if (sendsBefore !== 0) throw new Error('a message was sent before the /btw step');
  await page.locator('#prompt').fill('/btw what does the index cost?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.btw-transcript', { state: 'visible', timeout: 30_000 });
  const sideId = await page.evaluate(() => {
    const calls = (window.__perfCalls ?? []).filter(call => call.command === 'send_message');
    return calls.length ? calls.at(-1).args.sessionId : null;
  });
  if (!sideId) throw new Error('no side thread was created by /btw');
  await page.waitForFunction(() => document.querySelectorAll('.btw-transcript [data-message-id]').length > 100, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  cell.btwCounts = await page.evaluate(counts);
  cell.btwSky = await page.evaluate(skyState);

  await page.evaluate(scrollProbe, ['.btw-transcript', 600, SCROLL_SPEED / 2]);
  await page.waitForTimeout(300);
  // --- the side thread's scroll. **Synthetic**, exactly like `mainScroll`: a `scrollTop` assignment, no reader event, so the
  // hold cannot arm here either. It now reports its own `skyFramesDelta` (cumulative `__sky.frames` differenced over the window,
  // like the main cells): without it a document could borrow the main-scroll number for this column.
  const btwSceneCss = await sceneCssState();
  const btwScrollFramesBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const btwScrollBefore = await metrics();
  const btwScroll = await page.evaluate(scrollProbe, ['.btw-transcript', SCROLL_MS, SCROLL_SPEED / 2]);
  const btwScrollAfter = await metrics();
  const btwScrollFramesAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const longTasksBtw = await page.evaluate(() => window.__perfLongTasks);
  const btwScrollWindowMs = btwScroll.windowMs ?? SCROLL_MS;
  cell.btwScroll = withSky({
    kind: CELL_KIND.btwScroll,
    ...frameStats(btwScroll.deltas),
    longTasks: longTasksBetween(longTasksBtw, btwScroll.start, btwScroll.end),
    scrollHeight: btwScroll.scrollHeight, clientHeight: btwScroll.clientHeight, span: btwScroll.span,
    startTop: btwScroll.startTop, endTop: btwScroll.endTop, distancePx: btwScroll.distancePx,
    maxScrollTop: btwScroll.maxScrollTop, windowMs: btwScrollWindowMs,
    // The side column runs at half the main transcript's nominal rate; achieved is measured, not asserted.
    nominalPxPerSec: Math.round(SCROLL_SPEED / 2),
    achievedPxPerSec: round(btwScrollWindowMs ? btwScroll.distancePx / btwScrollWindowMs * 1000 : null),
    skyFramesDelta: btwScrollFramesBefore === null || btwScrollFramesAfter === null ? null : btwScrollFramesAfter - btwScrollFramesBefore,
    sceneCss: btwSceneCss,
    mainThread: metricDelta(btwScrollBefore, btwScrollAfter),
  }, await page.evaluate(skyState));

  // --- the reader's own scroll of the side thread: trusted wheel events over `.btw-transcript`. The product holds the sky on
  // that log too (`SCROLLERS` in src/sky-window.ts names `.btw-transcript`, and tests/sky.spec.ts has the spec), so this is the
  // cell that measures the owner's "the side panel stays smooth" claim with a real input event instead of a position write.
  // The panel is opened the way the cells above and `tests/sky.spec.ts` open it: `/btw` in the main prompt, no fixture.
  const btwWheelSceneCss = await sceneCssState();
  const btwPark = await page.evaluate(wheelPark, ['.btw-transcript', 0.1, 'btw', '.btw-transcript']);
  if (!btwPark.pointInsideScroller) throw new Error(`the side-thread wheel window would land on ${btwPark.pointHit}, not inside .btw-transcript`);
  if (!btwPark.pointOverMessage) console.warn(`WARNING: the side-thread wheel lands on ${btwPark.pointHit}, not on a .message: the pointer may drive the sky during this cell`);
  await page.mouse.move(btwPark.point.x, btwPark.point.y);
  await page.waitForTimeout(120);
  const btwWheelFramesBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const btwWheelBefore = await metrics();
  await page.evaluate(wheelArm, ['btw', SCROLL_MS]);
  // Ramped to the distance the programmatic side cell actually travelled, not to a nominal rate: "the two btw cells travel the
  // same distance" is then checkable from the JSON (`distancePx` on both).
  const btwWheelTargetPx = Math.max(1, Math.round(btwScroll.distancePx || btwScroll.span));
  const btwDrive = await driveWheel(page, btwWheelTargetPx);
  await waitWheelWindow(page, 'btw');
  const btwWheelAfter = await metrics();
  const btwWheelFramesAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  const btwWheel = await page.evaluate(wheelStop, ['btw']);
  if (!btwWheel.trustedTicks) throw new Error('the side-thread wheel window received no trusted wheel event over .btw-transcript');
  const btwWheelWindowMs = btwWheel.windowMs ?? SCROLL_MS;
  const btwWheelVsScroll = round(btwScroll.distancePx ? btwWheel.distancePx / btwScroll.distancePx : null);
  if (btwWheelVsScroll !== null && btwWheelVsScroll < 0.9) {
    console.warn(`WARNING: the side-thread wheel travelled ${btwWheel.distancePx}px, ${Math.round(btwWheelVsScroll * 100)}% of the programmatic side cell's ${btwScroll.distancePx}px: the two btw scroll cells are not comparable in this run`);
  }
  const longTasksBtwWheel = await page.evaluate(() => window.__perfLongTasks);
  const btwWheelTiming = await page.evaluate(() => window.__perfEvents);
  // The hold is 150 ms past the last reader event, not a stop: leave the panel and prove frames come back.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(250);
  const btwResumeBefore = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  await page.waitForTimeout(1000);
  const btwResumeAfter = await page.evaluate(() => (window.__sky ? window.__sky.frames : null));
  cell.btwWheel = withSky({
    kind: CELL_KIND.btwWheel,
    ...frameStats(btwWheel.deltas),
    longTasks: longTasksBetween(longTasksBtwWheel, btwWheel.start, btwWheel.end),
    ...wheelEventStats(btwWheelTiming, btwWheel.start, btwWheel.end),
    sceneCss: btwWheelSceneCss,
    mainThread: metricDelta(btwWheelBefore, btwWheelAfter),
    skyFramesDelta: btwWheelFramesBefore === null || btwWheelFramesAfter === null ? null : btwWheelFramesAfter - btwWheelFramesBefore,
    resumeFrames: btwResumeBefore === null || btwResumeAfter === null ? null : btwResumeAfter - btwResumeBefore,
    wheelTicks: btwWheel.ticks, trustedTicks: btwWheel.trustedTicks, driverTicks: btwDrive.driverTicks,
    wheelDeltaPx: btwWheel.wheelDeltaPx, deltaModes: btwWheel.deltaModes.join('/'), firstTicks: btwWheel.firstTicks.join('/'),
    startTop: btwWheel.startTop, endTop: btwWheel.endTop, peakTop: btwWheel.peakTop, maxScrollTop: btwWheel.maxScrollTop,
    distancePx: btwWheel.distancePx, endDistancePx: btwWheel.endDistancePx, travelPct: btwWheel.travelPct,
    nominalPxPerSec: Math.round(WHEEL_STEP / WHEEL_GAP * 1000), achievedPxPerSec: round(btwWheelWindowMs ? btwWheel.distancePx / btwWheelWindowMs * 1000 : null),
    targetDistancePx: btwWheelTargetPx, deliveredPx: btwDrive.deliveredPx, distanceVsProgrammatic: btwWheelVsScroll,
    scrolled: btwWheel.scrolled, atTop: btwWheel.atTop, nearBottom: btwWheel.nearBottom,
    scrollHeight: btwWheel.scrollHeight, clientHeight: btwWheel.clientHeight, windowMs: btwWheelWindowMs,
    point: `${Math.round(btwPark.point.x)},${Math.round(btwPark.point.y)}`, pointHit: btwPark.pointHit,
    pointOverMessage: btwPark.pointOverMessage, slot: btwWheel.slot, scope: btwWheel.scope,
  }, await page.evaluate(skyState));

  const btwFocus = await page.evaluate(typeStart, '.btw-input');
  if (!btwFocus.focused) throw new Error('the BTW composer did not take focus');
  const btwTypeSceneCss = await sceneCssState();
  const btwTypeBefore = await metrics();
  await page.keyboard.type(TYPE_TEXT, { delay: TYPE_DELAY });
  const btwTyped = await page.evaluate(typeStop);
  const btwTypeAfter = await metrics();
  const longTasksAfterBtw = await page.evaluate(() => window.__perfLongTasks);
  const btwEvents = await page.evaluate(() => window.__perfEvents);
  cell.btwTyping = withSky({
    kind: CELL_KIND.btwTyping,
    ...latencyStats(btwTyped.samples),
    ...eventStats(btwEvents, btwTyped.start, btwTyped.end, btwTyped.samples.length),
    inputs: btwTyped.inputs, chars: TYPE_TEXT.length, valueLength: btwTyped.valueLength,
    longTasks: longTasksBetween(longTasksAfterBtw, btwTyped.start, btwTyped.end),
    sceneCss: btwTypeSceneCss,
    mainThread: metricDelta(btwTypeBefore, btwTypeAfter),
  }, await page.evaluate(skyState));
  cell.skyAfter = await page.evaluate(skyState);
  // The render scale the sky's governor was running at, per cell and per window. `SCALE`/`LOW_SCALE` in src/sky-window.ts are
  // 0.6 and 0.45: paints averaging over its ~8 ms budget drop it, so a cell measured at 0.45 rendered ~44 % fewer pixels than the
  // same cell at 0.6 — a before/after pair is only comparable if a reader can see that, and `gpuMs` is what tripped it.
  cell.renderScale = {
    before: cell.skyBefore?.scale ?? null, after: cell.skyAfter?.scale ?? null,
    gpuMsBefore: cell.skyBefore?.gpuMs ?? null, gpuMsAfter: cell.skyAfter?.gpuMs ?? null,
    windows: Object.fromEntries(SECTIONS.map(section => [section, cell[section]?.skyScale ?? null])),
    gpuMs: Object.fromEntries(SECTIONS.map(section => [section, cell[section]?.skyGpuMs ?? null])),
    values: [...new Set(SECTIONS.map(section => cell[section]?.skyScale).filter(value => typeof value === 'number'))].sort(),
  };
  await context.close();
  pageErrors.push(...errors);
  return cell;
}

// ---------------------------------------------------------------- main
const SECTIONS = ['mainScroll', 'mainWheel', 'mainTyping', 'mainStream', 'btwScroll', 'btwWheel', 'btwTyping'];
const median = values => {
  const sorted = values.filter(value => typeof value === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};
/** Per sky state: the median across repeats of every numeric leaf (booleans and strings pass through). The render scale is
 *  the exception: it is a discrete mode (0.6, or 0.45 while the governor is tripped), so a median of 0.6 and 0.45 would report
 *  0.525 — a scale the sky never ran at. A cell's `skyScale` is therefore reported as the set of values its repeats ran at
 *  (`{ values, min, max, uniform }`) and the probe's nested `sky.scale` as null, with the same set per state in
 *  `modes.<raster>.scale` and `summary.<state>.scale` beside the repeat numbers that ran at each.
 *  `kind` passes through `walk`'s string branch unchanged: it is the cell's input mark, not a measurement. */
function medianCell(cells) {
  const modesOf = values => {
    const seen = [...new Set(values.filter(value => typeof value === 'number'))].sort((a, b) => a - b);
    return { values: seen, min: seen.length ? seen[0] : null, max: seen.length ? seen.at(-1) : null, uniform: seen.length <= 1 };
  };
  const walk = (values, template, path) => {
    // Paths are `<section>.<field>`: a cell's top-level `skyScale` and the probe's nested `sky.scale` are both modes.
    if (path.endsWith('skyScale')) return modesOf(values);
    if (typeof template === 'number' || template === null) return path.endsWith('.sky.scale') ? null : median(values);
    if (typeof template !== 'object') return template;
    return Object.fromEntries(Object.keys(template).map(key => [key, walk(values.map(value => value?.[key]), template[key], path ? `${path}.${key}` : key)]));
  };
  const template = JSON.parse(JSON.stringify(cells[0]));
  return Object.fromEntries(SECTIONS.map(section => [section, walk(cells.map(cell => cell[section]), template[section], section)]));
}
/** sky on vs sky off (or sky on vs scene-css off), per metric: the ratio and the absolute difference. */
function deltasFor(on, off) {
  const out = {};
  for (const section of SECTIONS) {
    const pairs = {
      p50: [on[section]?.p50, off[section]?.p50], p95: [on[section]?.p95, off[section]?.p95], p99: [on[section]?.p99, off[section]?.p99],
      max: [on[section]?.max, off[section]?.max],
      // `over33` is the smoothness headline: 33.4 ms is two vsyncs at 60 Hz. `over34` is kept for continuity with older JSONs.
      over25: [on[section]?.over25, off[section]?.over25], over33: [on[section]?.over33, off[section]?.over33],
      over34: [on[section]?.over34, off[section]?.over34],
      frames: [on[section]?.frames, off[section]?.frames],
      busyPct: [on[section]?.mainThread?.busyPct, off[section]?.mainThread?.busyPct],
      taskMs: [on[section]?.mainThread?.taskMs, off[section]?.mainThread?.taskMs],
      longTaskMs: [on[section]?.longTasks?.totalMs, off[section]?.longTasks?.totalMs],
      keystrokes: [on[section]?.keystrokes, off[section]?.keystrokes],
      slowEvents: [on[section]?.slowEvents, off[section]?.slowEvents],
      // Input events of any type in the wheel window (hover/pointer churn included) — never wheel latency: Event Timing has no
      // `wheel` type, which is why the `slowWheel` pair that used to sit here could only ever report 0.
      slowEventsAll: [on[section]?.slowEventsAll, off[section]?.slowEventsAll],
      slowShare: [on[section]?.slowShare, off[section]?.slowShare],
      // Normalized streaming work (compare runs on `busyPctPer1kChars`) and each scroll cell's measured rate, so the on/off
      // table cannot show an intent where a measurement belongs.
      busyPer1kChars: [on[section]?.busyPctPer1kChars, off[section]?.busyPctPer1kChars],
      busyPerFrame: [on[section]?.busyPctPerFrame, off[section]?.busyPctPerFrame],
      achievedPxPerSec: [on[section]?.achievedPxPerSec, off[section]?.achievedPxPerSec],
      distancePx: [on[section]?.distancePx, off[section]?.distancePx],
      skyFrames: [on[section]?.skyFramesDelta, off[section]?.skyFramesDelta],
      trustedTicks: [on[section]?.trustedTicks, off[section]?.trustedTicks],
      // The sky's mean GPU time beside the window. The scale itself is a mode, never an average: it is reported per cell as
      // `skyScale: { values, min, max, uniform }` and compared in `modes.<raster>.scaleDelta`.
      renderGpuMs: [on[section]?.skyGpuMs, off[section]?.skyGpuMs],
    };
    out[section] = Object.fromEntries(Object.entries(pairs)
      .filter(([, [a, b]]) => typeof a === 'number' && typeof b === 'number')
      .map(([key, [a, b]]) => [key, { on: a, off: b, ratio: round(b ? a / b : null), delta: round(a - b) }]));
  }
  return out;
}

async function main() {
  // The 1-minute load when the run begins: a JSON whose cells came off a busy box should say so up front, not only per cell
  // (`cell.loadavg`) and at the end (`env.loadavgAtEnd`).
  const loadavgAtStart = loadavg().map(value => Math.round(value * 100) / 100);
  if (!['on', 'off', 'both'].includes(SCENE_CSS)) throw new Error(`--scene-css ${SCENE_CSS}: expected on|off|both`);
  if (WORKTREE === '') throw new Error('--worktree needs a path (a checkout or `git archive HEAD` tree of the same commit)');
  if (EXPECT_COMMIT === '') throw new Error('--expect-commit needs a commit sha');
  // vite's dependency optimizer walks up from the project root; an empty package.json there
  // breaks it ("Unexpected end of file in JSON") before the dev server can answer.
  const strayPackage = join(repo, '..', '..', 'package.json');
  if (existsSync(strayPackage) && statSync(strayPackage).size === 0) {
    console.warn(`WARNING: ${strayPackage} is empty. vite refuses to prebundle dependencies while it exists; move it aside.`);
  }
  const prov = provenance();
  printProvenance(prov);
  if (SCENE_CSS !== 'both') console.log(`scene CSS: ${SCENE_CSS} — recorded, not a filter: the css-off cell (canvas painting, data-scene removed) is measured alongside sky-on and sky-off for every raster`);
  if (DRY_RUN) {
    console.log('\ndry run: provenance verified, nothing started');
    // The cells a run would measure — every one of them, with what drives it, so `--dry-run` is also the place to check that
    // a synthetic `scrollTop` row and a real wheel row are not the same experiment.
    console.log(`\ncells (${SECTIONS.length}: ${STATES.join(' / ')} x ${REPEATS} repeat(s) per raster, raster ${RASTER})`);
    for (const name of SECTIONS) console.log(`  ${name.padEnd(11)} ${(CELL_KIND[name] ?? '?').padEnd(9)} ${CELL_LABEL[name] ?? ''}`);
    console.log(`  thresholds  over25 ${25} ms · over33 ${33} ms (two vsyncs at 60 Hz — the smoothness headline) · over34 ${34} ms (kept for continuity) · over50 50 ms`);
    console.log('  scale       recorded per cell: 0.6 is SCALE, 0.45 LOW_SCALE after src/sky-window.ts governor trips (gpuMs beside it)');
    console.log(JSON.stringify({ env: { harness: prov.harness, commit: prov.commit, srcTree: prov.srcTree.sha256, srcTreeFiles: prov.srcTree.files, worktree: prov.worktree, loadavgAtStart, serverReused: null }, cells: SECTIONS.map(name => ({ name, kind: CELL_KIND[name], label: CELL_LABEL[name] })) }, null, 2));
    return;
  }
  const server = await ensureServer();
  console.log(`dev server ${BASE} ${server.reused ? '(reused)' : '(started)'} serving ${SERVE_ROOT}`);
  const modes = RASTER === 'both' ? ['gpu', 'software'] : [RASTER];
  const pageErrors = [];
  const results = {};
  try {
    for (const mode of modes) {
      const type = BROWSER === 'webkit' ? webkit : chromium;
      const launchArgs = BROWSER === 'webkit' ? [] : [...LAUNCH_ARGS, ...(mode === 'software' ? SOFTWARE_ARGS : [])];
      const browser = await type.launch({ headless: true, args: launchArgs });
      const runs = [];
      // Interleave the states and rotate their order every repeat, so a machine that gets busier or
      // quieter during the run does not bias one state (this box runs a desktop too).
      const schedule = [];
      for (let repeat = 0; repeat < REPEATS; repeat++) {
        const order = [...STATES];
        for (let turn = 0; turn < repeat % STATES.length; turn++) order.push(order.shift());
        for (const state of order) schedule.push({ state, repeat });
      }
      try {
        for (const { state, repeat } of schedule) {
          const cell = await measureCell(browser, state, repeat, pageErrors);
          cell.raster = mode;
          runs.push(cell);
          const s = cell.mainScroll, w = cell.mainWheel, t = cell.mainTyping, m = cell.mainStream, b = cell.btwScroll, bw = cell.btwWheel;
          console.log(`[${mode}] sky ${cell.sky}${cell.state === 'css-off' ? ' (scene CSS off)' : ''} #${repeat + 1}`
            + `  scroll(syn) p95 ${s.p95}ms >33 ${s.over33} busy ${s.mainThread ? s.mainThread.busyPct + '%' : 'n/a'} sky frames ${s.skyFramesDelta}`
            + `  |  wheel(real) p95 ${w?.p95}ms >33 ${w?.over33} busy ${w?.mainThread ? w.mainThread.busyPct + '%' : 'n/a'}`
            + ` sky frames ${w?.skyFramesDelta} moved ${w?.distancePx}px @ ${w?.achievedPxPerSec}px/s (nominal ${w?.nominalPxPerSec}, vs scroll x${w?.distanceVsProgrammatic})${w?.scrolled ? '' : ' (DID NOT SCROLL)'}`
            + `  |  type p95 ${t.p95}ms slow ${t.slowEvents}/${t.keystrokes} busy ${t.mainThread ? t.mainThread.busyPct + '%' : 'n/a'}`
            + `  |  stream p95 ${m.p95}ms >33 ${m.over33} sky frames ${m.skyFramesDelta}`
            + ` busy ${m.busyPctPer1kChars}%/1k chars (${m.busyPctPerFrame}%/frame, ${m.streamedChars} chars/${m.streamedFrames} frames)`
            + `  |  btw scroll(syn) p95 ${b.p95}ms >33 ${b.over33} busy ${b.mainThread ? b.mainThread.busyPct + '%' : 'n/a'} sky frames ${b.skyFramesDelta}`
            + `  |  btw wheel(real) p95 ${bw?.p95}ms >33 ${bw?.over33} busy ${bw?.mainThread ? bw.mainThread.busyPct + '%' : 'n/a'}`
            + ` sky frames ${bw?.skyFramesDelta} moved ${bw?.distancePx}px @ ${bw?.achievedPxPerSec}px/s (vs btw scroll x${bw?.distanceVsProgrammatic}, ticks ${bw?.trustedTicks}/${bw?.wheelTicks})${bw?.scrolled ? '' : ' (DID NOT SCROLL)'}`
            + `  |  scale ${cell.renderScale?.values.join('/')}${cell.renderScale?.values.length > 1 ? ' (GOVERNOR TRIPPED)' : ''}`);
        }
      } finally { await browser.close(); }
      // This box also runs the owner's desktop, so a repeat can be spoiled by an unrelated stall
      // (a software-mode run here parked a 1.8 s scroll on somebody else's build). Interference can
      // only ADD main-thread work, never remove it, so the baseline keeps the least-contended
      // repeats: those within 35% of the group's best main-thread cost. Everything stays in the JSON.
      const group = state => runs.filter(run => run.state === state);
      const score = cell => cell.mainScroll?.mainThread?.busyPct ?? cell.mainScroll?.p95 ?? 0;
      for (const state of STATES) {
        const cells = group(state);
        if (!cells.length) continue;
        const best = Math.min(...cells.map(score));
        for (const cell of cells) cell.rejected = cells.length > 1 && score(cell) > best * 1.35;
      }
      const kept = state => { const cells = group(state).filter(cell => !cell.rejected); return cells.length ? cells : group(state); };
      // The render scale is a discrete mode, so it is summarised as the set of values the kept repeats ran at (with the repeat
      // numbers), never as an average: 0.6 is src/sky-window.ts's SCALE, 0.45 its LOW_SCALE after the governor tripped on a
      // ~24 ms gpuMs. A before/after pair measured in different scales is not a like-for-like comparison, and this is where a
      // reader sees that it was not.
      const scaleSummary = state => {
        const cells = kept(state);
        const perCell = cells.map(cell => ({
          repeat: cell.repeat + 1, scale: cell.skyAfter?.scale ?? null, gpuMs: cell.skyAfter?.gpuMs ?? null,
          windows: cell.renderScale?.windows ?? null, gpuMsByWindow: cell.renderScale?.gpuMs ?? null,
        }));
        const values = [...new Set(cells.flatMap(cell => cell.renderScale?.values ?? []))].sort((a, b) => a - b);
        const gpu = perCell.map(row => row.gpuMs).filter(value => typeof value === 'number');
        return {
          values, min: values.length ? values[0] : null, max: values.length ? values.at(-1) : null, uniform: values.length <= 1,
          gpuMsMedian: median(gpu), perCell,
        };
      };
      const summary = Object.fromEntries(STATES.map(state => [state, { ...medianCell(kept(state)), scale: scaleSummary(state) }]));
      // Whether the before/after sides ran at the same render scale: the first thing to check before comparing any frame count.
      const scaleDelta = Object.fromEntries(STATES.map(state => [state, summary[state].scale]));
      results[mode] = {
        summary,
        scale: scaleDelta,
        deltas: deltasFor(summary.on, summary.off),
        deltasSceneCss: summary['css-off'] ? deltasFor(summary.on, summary['css-off']) : null,
        // What drives each cell: a synthetic row is a position write and cannot stand for the owner's gesture.
        cells: CELL_LABEL, cellKinds: CELL_KIND,
        runs, renderer: runs[0]?.skyBefore?.renderer ?? null,
      };
      const scales = state => {
        const scale = scaleDelta[state];
        return `scale ${scale ? scale.values.join('/') || 'n/a' : 'n/a'}${scale && !scale.uniform ? ' (GOVERNOR TRIPPED: quality differs inside this state)' : ''}`
          + (scale && typeof scale.gpuMsMedian === 'number' ? ` gpuMs ${scale.gpuMsMedian}` : '');
      };
      console.log(`[${mode}] render scale (on: ${scales('on')} | off: ${scales('off')}${scaleDelta['css-off'] ? ` | css-off: ${scales('css-off')}` : ''})`
        + ` — 0.6 is SCALE, 0.45 LOW_SCALE in src/sky-window.ts`);
      for (const state of STATES) {
        const cells = group(state), dropped = cells.filter(cell => cell.rejected);
        console.log(`[${mode}] sky ${state}: ${cells.length - dropped.length}/${cells.length} repeats used (best ${Math.min(...cells.map(score))}%)`
          + (dropped.length ? `, dropped ${dropped.map(cell => `#${cell.repeat + 1} (${score(cell)}%)`).join(', ')}` : ''));
      }
    }
  } finally {
    if (server.child) server.child.kill('SIGTERM');
  }

  const output = {
    generatedAt: new Date().toISOString(),
    url: `${BASE}/?sky=12:00&scene=sky`,
    env: {
      // Provenance: which script measured which tree. Without this a JSON cannot be compared with another.
      harness: prov.harness, harnessPath: prov.harnessPath,
      commit: prov.commit, srcTree: prov.srcTree.sha256, srcTreeFiles: prov.srcTree.files,
      srcTreeStat: prov.srcTree.stat, srcTreeClean: prov.srcTree.clean,
      worktree: prov.worktree,
      node: process.version, browser: BROWSER, raster: RASTER,
      playwright: JSON.parse(readFileSync(join(repo, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version,
      viewport: '1440x940', platform: process.platform, arch: process.arch, cpu: readCpuModel(),
      loadavgAtStart, loadavgAtEnd: loadavg().map(value => Math.round(value * 100) / 100),
      // Provenance of the server these numbers came off: a reused one may be serving another tree than `worktree` says.
      serverReused: server.reused, serverStarted: !server.reused, serverPort: PORT, devServer: BASE,
    },
    config: {
      raster: RASTER, states: STATES, sceneCss: `${SCENE_CSS} (css-off always measured)`,
      launchArgs: LAUNCH_ARGS, rasterArgs: { gpu: LAUNCH_ARGS, software: SOFTWARE_ARGS },
      messages: MESSAGES, seededRows: ROWS.length, scrollMs: SCROLL_MS, scrollSpeedPxPerSec: SCROLL_SPEED,
      // Both `*SpeedPxPerSec` values below are the *nominal* intent. What each scroll cell measured is in the cell:
      // `mainScroll.achievedPxPerSec` and `mainWheel.achievedPxPerSec`, computed as distancePx / windowMs.
      scrollSpeedKind: 'nominal: px/s the programmatic cell assigns per frame (measured: mainScroll.achievedPxPerSec)',
      wheelStepPx: WHEEL_STEP, wheelGapMs: WHEEL_GAP, wheelSpeedPxPerSec: Math.round(WHEEL_STEP / WHEEL_GAP * 1000),
      wheelSpeedKind: 'nominal: one wheelStepPx notch every wheelGapMs (measured: mainWheel.achievedPxPerSec)',
      wheelMaxStepPx: WHEEL_MAX_STEP,
      wheelTargetRule: 'notches ramp to mainScroll.distancePx over scrollMs, then stop once that distance is delivered',
      streamMs: STREAM_MS, streamChunkChars: STREAM_CHUNK,
      // Compare two runs on this field, not on the raw busy %: the streamed payload differs when the frame count does.
      streamNormalizedField: 'mainStream.busyPctPer1kChars',
      // The smoothness headline: 33.4 ms is two vsyncs at 60 Hz, so `over33` counts frames that missed a whole vsync (a cell
      // that drops every other frame can sit at a 17 ms p95 with a dozen `over33` in the same 2 s). `over34` is kept because
      // every earlier JSON reports it; `over25` catches a 1.5-vsync frame that neither of the others sees. Applies to every
      // frame cell and, for keystroke latency, to `mainTyping`/`btwTyping`.
      frameThresholdsMs: { over25: 25, over33: 33, over34: 34, over50: 50 },
      smoothnessHeadlineField: 'over33 (frames over two vsyncs at 60 Hz)',
      // Event Timing has no `wheel` entry type, so no cell can report wheel latency: the field that used to look like one
      // (`slowWheel`) was always 0. `slowEventsAll` is every input entry in the window, hover churn included.
      eventTimingNote: 'no Event Timing type for wheel: `slowEventsAll` counts input events of any type in the window (hover/pointer/keydown churn under a parked cursor), never wheel latency',
      // Which cells are the reader's gesture and which are the harness's own writes (also per cell: `<cell>.kind`).
      cells: CELL_LABEL, cellKinds: CELL_KIND,
      // The render scale is recorded per cell (`<cell>.skyScale`, `<cell>.sky.gpuMs`) and summarised per state in
      // `modes.<raster>.scale`; it is a mode, never a median.
      renderScaleNote: 'src/sky-window.ts scales the canvas 0.6 of device pixels, 0.45 while the governor is tripped; compare two runs only at the same scale',
      chars: TYPE_TEXT.length, typeDelayMs: TYPE_DELAY, repeats: REPEATS, devServer: BASE, worktree: SERVE_ROOT,
    },
    modes: results,
    pageErrors,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output, null, 2));

  const headline = d => d && ({
    scrollP95: d.mainScroll.p95, scrollOver33: d.mainScroll.over33, scrollBusyPct: d.mainScroll.busyPct, scrollTaskMs: d.mainScroll.taskMs,
    scrollSkyFrames: d.mainScroll.skyFrames, scrollAchievedPxPerSec: d.mainScroll.achievedPxPerSec,
    wheelP95: d.mainWheel?.p95, wheelOver33: d.mainWheel?.over33, wheelOver34: d.mainWheel?.over34, wheelBusyPct: d.mainWheel?.busyPct,
    wheelSkyFrames: d.mainWheel?.skyFrames, wheelTrustedTicks: d.mainWheel?.trustedTicks,
    wheelInputEventsAll: d.mainWheel?.slowEventsAll,
    wheelAchievedPxPerSec: d.mainWheel?.achievedPxPerSec, wheelVsScrollDistance: d.mainWheel?.distanceVsProgrammatic,
    typeP95: d.mainTyping.p95, typeSlowEvents: d.mainTyping.slowEvents, typeSlowShare: d.mainTyping.slowShare, typeBusyPct: d.mainTyping.busyPct,
    streamP95: d.mainStream.p95, streamOver33: d.mainStream.over33, streamOver34: d.mainStream.over34, streamSkyFrames: d.mainStream.skyFrames,
    streamBusyPer1kChars: d.mainStream.busyPctPer1kChars, streamBusyPerFrame: d.mainStream.busyPctPerFrame,
    btwScrollP95: d.btwScroll.p95, btwScrollOver33: d.btwScroll.over33, btwScrollBusyPct: d.btwScroll.busyPct, btwScrollSkyFrames: d.btwScroll.skyFrames,
    btwWheelP95: d.btwWheel?.p95, btwWheelOver33: d.btwWheel?.over33, btwWheelBusyPct: d.btwWheel?.busyPct,
    btwWheelSkyFrames: d.btwWheel?.skyFrames, btwWheelTrustedTicks: d.btwWheel?.trustedTicks,
    btwWheelAchievedPxPerSec: d.btwWheel?.achievedPxPerSec,
    btwTypeP95: d.btwTyping.p95, btwTypeOver33: d.btwTyping.over33,
  });
  // The mark a document needs: a synthetic row must never be read as the owner's gesture. The column names carry it, and every
  // summary cell carries the same word in its `kind` field.
  console.log('legend: (syn) = SYNTHETIC, the harness assigns scrollTop per frame — no reader event, so the sky\'s hold cannot arm;'
    + ' (real) = REAL reader input (trusted page.mouse.wheel / key events); >25/>33/>34 count frames over 25/33/34 ms (33 ms = two vsyncs);'
    + ' >34 kept for continuity with older JSONs; scale is the sky\'s render scale (0.6 base, 0.45 while its governor is tripped)');
  for (const mode of Object.keys(results)) {
    const { summary, deltas, deltasSceneCss } = results[mode];
    const row = state => {
      const c = summary[state];
      if (!c) return null;
      return {
        state,
        'scale': c.scale?.values.join('/') ?? null, 'gpu ms': c.scale?.gpuMsMedian ?? null,
        'scroll (syn) p95': c.mainScroll.p95, 'scroll (syn) p99': c.mainScroll.p99, 'scroll (syn) max': c.mainScroll.max,
        'scroll (syn) >25': c.mainScroll.over25, 'scroll (syn) >33': c.mainScroll.over33, 'scroll (syn) >34': c.mainScroll.over34,
        'scroll (syn) longtask ms': c.mainScroll.longTasks.totalMs, 'scroll (syn) busy %': c.mainScroll.mainThread?.busyPct ?? null,
        'scroll (syn) sky frames': c.mainScroll.skyFramesDelta,
        'scroll (syn) px': c.mainScroll.distancePx ?? null, 'scroll (syn) px/s': c.mainScroll.achievedPxPerSec ?? null,
        'wheel (real) p95': c.mainWheel?.p95 ?? null, 'wheel (real) p99': c.mainWheel?.p99 ?? null,
        'wheel (real) >25': c.mainWheel?.over25 ?? null, 'wheel (real) >33': c.mainWheel?.over33 ?? null, 'wheel (real) >34': c.mainWheel?.over34 ?? null,
        'wheel (real) busy %': c.mainWheel?.mainThread?.busyPct ?? null, 'wheel (real) sky frames': c.mainWheel?.skyFramesDelta ?? null,
        'wheel (real) ticks': c.mainWheel?.trustedTicks ?? null, 'input events, any type': c.mainWheel?.slowEventsAll ?? null,
        'wheel (real) moved px': c.mainWheel?.distancePx ?? null, 'wheel (real) px/s': c.mainWheel?.achievedPxPerSec ?? null,
        'wheel (real) /scroll': c.mainWheel?.distanceVsProgrammatic ?? null, 'wheel (real) resume frames': c.mainWheel?.resumeFrames ?? null,
        'type p95': c.mainTyping.p95, 'type max': c.mainTyping.max, 'type >33': c.mainTyping.over33,
        'type slow': c.mainTyping.slowEvents, 'type busy %': c.mainTyping.mainThread?.busyPct ?? null,
        'stream (app) p95': c.mainStream?.p95 ?? null, 'stream (app) >33': c.mainStream?.over33 ?? null, 'stream (app) sky frames': c.mainStream?.skyFramesDelta ?? null,
        'stream (app) busy %/frame': c.mainStream?.busyPctPerFrame ?? null, 'stream (app) busy %/1k ch': c.mainStream?.busyPctPer1kChars ?? null,
        'btw scroll (syn) p95': c.btwScroll.p95, 'btw scroll (syn) >33': c.btwScroll.over33,
        'btw scroll (syn) busy %': c.btwScroll.mainThread?.busyPct ?? null, 'btw scroll (syn) sky frames': c.btwScroll.skyFramesDelta ?? null,
        'btw wheel (real) p95': c.btwWheel?.p95 ?? null, 'btw wheel (real) >33': c.btwWheel?.over33 ?? null,
        'btw wheel (real) busy %': c.btwWheel?.mainThread?.busyPct ?? null, 'btw wheel (real) sky frames': c.btwWheel?.skyFramesDelta ?? null,
        'btw wheel (real) ticks': c.btwWheel?.trustedTicks ?? null, 'btw wheel (real) moved px': c.btwWheel?.distancePx ?? null,
        'btw wheel (real) px/s': c.btwWheel?.achievedPxPerSec ?? null, 'btw type p95': c.btwTyping.p95,
        'btw type >33': c.btwTyping.over33, 'btw type slow': c.btwTyping.slowEvents,
      };
    };
    const scaleLine = state => {
      const scale = results[mode].scale?.[state];
      if (!scale) return 'n/a';
      return `${scale.values.join('/') || 'n/a'}${scale.uniform ? '' : ' (governor tripped: ' + scale.perCell.filter(cell => cell.scale !== scale.max).map(cell => `#${cell.repeat} @ ${cell.scale}`).join(', ') + ')'}`
        + (typeof scale.gpuMsMedian === 'number' ? ` gpuMs ${scale.gpuMsMedian}` : '');
    };
    console.log(`\n[${mode}] medians over ${REPEATS} repeat(s), ms — renderer: ${results[mode].renderer}`);
    console.log(`[${mode}] render scale on ${scaleLine('on')} | off ${scaleLine('off')}${results[mode].scale?.['css-off'] ? ` | css-off ${scaleLine('css-off')}` : ''}`);
    console.table(STATES.map(row).filter(Boolean));
    console.log(`[${mode}] sky on / sky off:`, JSON.stringify(headline(deltas)));
    if (deltasSceneCss) console.log(`[${mode}] sky on / scene-css off:`, JSON.stringify(headline(deltasSceneCss)));
  }
  console.log(`\nresults: ${OUT}`);
  if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5));
}

function readCpuModel() {
  try {
    const line = readFileSync('/proc/cpuinfo', 'utf8').split('\n').find(entry => entry.startsWith('model name'));
    return line ? line.split(':')[1].trim() : null;
  } catch { return null; }
}

try {
  await main();
} catch (error) {
  console.error(`\nperf-lag failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
