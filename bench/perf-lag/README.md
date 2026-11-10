# perf-lag — main thread vs. the sky scene

## Scope: the patch is `src/`, `tests/`, `docs/` — this directory is its measurement apparatus

The pull request under review is `src/`, `tests/` and `docs/`: those are the files a reviewer reads and judges.
Nothing in `bench/perf-lag/` is part of it — this directory is the local measurement apparatus the fix was
checked with, not product code and not part of the diff. `bench/perf-lag/run.mjs` is the harness that produces
the numbers, `bench/perf-lag/results/*.json` and the comparison document they feed are the evidence those
numbers were read from, and `bench/perf-lag/results/` is generated output: a run writes it, nobody edits it by
hand. Read `src/sky-window.ts`, `src/sky-window.css`, `src/main.ts`, `src/thread-tiles.css`,
`src/turn-card.css`, `tests/*.spec.ts` and `docs/agent-reference.md` for the change; open this directory only to
see how the numbers were produced, or to reproduce them.

## The report

A repeatable baseline for the owner's report:

> "the main thread is laggy when scrolling a long transcript and when typing in the composer,
> since the new WebGL sky appearance; the BTW side panel is smooth."

It measures seven cells, in three states, in one run. Each cell carries a **kind** label in the JSON
(`cells`/`cellKinds`) and in its stdout line, because a position write and a reader gesture are not the same
measurement:

| cell | kind | what drives it | what it reports |
|---|---|---|---|
| `mainScroll` | **synthetic** | `#transcript`, a synthetic fling: `scrollTop` advanced per frame at a nominal 3 000 px/s — no reader event, so the sky's hold cannot arm | frame pacing, long tasks, main-thread work, **sky frames painted during the window** |
| `mainWheel` | **reader** | `#transcript`, **real wheel input** (`page.mouse.wheel`, one notch every 40 ms, ramped to the distance `mainScroll` actually travelled over the same 2 s window; 3 000 px/s is the nominal step/gap, `achievedPxPerSec` is measured) | as `mainScroll`, plus the trusted-event count, the distance travelled and where it ended |
| `mainTyping` | **reader** | `#prompt`, 40 real key events | keystroke latency, **Event Timing slow events**, main-thread work |
| `mainStream` | **app** | `#transcript[data-running]`, a reply growing every frame while the app pins to the bottom — the app's own pin is a position write, not a reader event | frame pacing, main-thread work, **sky frames painted during the window (the run must keep its wind)** |
| `btwScroll` | **synthetic** | `.btw-transcript` (same seeded rows, narrow column), `scrollTop` per frame | as `mainScroll` |
| `btwWheel` | **reader** | `.btw-transcript`, **real wheel input** (`page.mouse.wheel`, ramped to `btwScroll`'s distance) | as `mainWheel`, on the side thread |
| `btwTyping` | **reader** | `.btw-input`, 40 real key events | as `mainTyping`, in the side composer |

Every frame cell reports `over25`, `over33` and `over34` — frames that missed one, two, or two-plus 60 Hz
slots. `over33` (33.4 ms = two vsyncs at 60 Hz) is the smoothness headline; `over34` is kept for continuity
with older JSONs. There is no `slowWheel` field any more: Event Timing has no `wheel` entry type, so a count
of "slow wheel events" could only ever be 0. The `btwWheel` cell replaces that intent with a measurement —
trusted wheel events over the side transcript, and what the renderer did with them.

| state | canvas | `data-scene` (the sky's CSS) | why |
|---|---|---|---|
| `on` | painting | on | the owner's report |
| `off` | none | — | the control |
| `css-off` | painting | removed | the scene CSS, measured while the canvas still paints and the reader hold still runs |

All three are measured in every run, per raster, interleaved and rotated across repeats, so a run always
contains its own controls and the isolation that explains the mechanism. `--scene-css` / `--no-scene-css`
name the treatment the isolation is about and are recorded in the JSON, but they never filter cells: a run
without the `css-off` cell would not be able to say which half of "the sky" cost anything.

`css-off` does **not** drop the canvas or the hold: the hold is armed from the wheel / pointer / key listeners in
`src/sky-window.ts`, not from `data-scene`, and the JSON shows the gesture still landing there — `resumeFrames` is 8 in
`on` and 8 in `css-off`, 0 in `off`, and after the fix `css-off` paints 0.5–1 sky frames where the before side painted
16. So read the three states as: `on` → `css-off` = the scene CSS (with the hold as that run had it), `css-off` → `off`
= the canvas (with the hold as that run had it), and a before/after difference *inside* one state = what the fix did in
that state.

## Run it

```bash
cd <checkout>                   # the repo root, the directory that holds bench/
npm install                     # once; leaves package-lock.json untouched
npx playwright install chromium # once (WebKit cannot run here, see Caveats)

node bench/perf-lag/run.mjs                  # 3 states x 2 repeats x 2 rasters
node bench/perf-lag/run.mjs --repeats 4      # the repeat count the tables below used
node bench/perf-lag/run.mjs --dry-run        # provenance + config, nothing started
```

It starts its own dev server when nothing is listening on `:1420` and stops it afterwards. Everything is
written to the `--out` path (default `bench/perf-lag/results/baseline.json`) and the tables are printed to
stdout.

No source file is edited: the seeded thread, the sky switch and the `css-off` state are wired the way
`tests/*.spec.ts` do it, by rewriting `src/preview.ts` and `src/main.ts` **on the wire** (`page.route`),
and by removing `data-scene` after load. A running dev server, the Tauri app and the repo tree stay
untouched.

### The honest before/after pair

The fix is the uncommitted diff in this checkout, so the pre-fix tree is this commit's tree. One script,
two commands, same commit — `env.harness`, `env.commit` and `env.srcTree` in each JSON prove it:

```bash
cd <checkout>                   # the repo root, the directory that holds bench/

# 1) PRE-FIX: pristine HEAD into /tmp, served by the same harness (repeat 4 for the real measurement)
rm -rf /tmp/perf-prefix && mkdir -p /tmp/perf-prefix
git archive HEAD | tar -x -C /tmp/perf-prefix
node bench/perf-lag/run.mjs --worktree /tmp/perf-prefix --repeats 4 \
  --out /tmp/perf-before.json

# 2) POST-FIX: this checkout, fix applied (same script, same command line minus --worktree)
node bench/perf-lag/run.mjs --repeats 4 \
  --out /tmp/perf-after.json
```

Write a pair into `/tmp` when you are reproducing it. `results/` holds only the one pair the current
comparison document was written from ([Results on disk](#results-on-disk)).

Run them back to back on a quiet box. The harness rotates the states inside each run, so the two JSONs
are comparable cell for cell. `--worktree` starts vite *in that tree* (`cwd`), so it
serves that tree's `src/`; the first run creates a `node_modules` symlink in it (untracked, gitignored,
no git state written) and says so.

If the fix is ever committed, the same pair still works with the commit it was based on:
`git archive <base> | tar -x -C /tmp/perf-prefix` and add `--expect-commit <base>` to the first
command — `--worktree` refuses to measure a tree that is not the commit it was told to expect, so the
"before" JS on records a different `env.commit` than the "after" one and no reader can mistake them
for one commit.

Contrasting them:

```bash
node -e 'for (const f of ["before","after"]) { const d = require(`/tmp/perf-${f}.json`);
  console.log(f, d.env.harness.slice(0,12), d.env.srcTree.slice(0,12), Object.keys(d.modes)); }'
```

Same `env.harness` in both, different `env.srcTree`: one script, two trees, both at `env.commit`.

The pair this README's later sections are synced to is `results/before6.json` / `results/after7.json` (same
two commands, `--out …/before6.json` and `--out …/after7.json`, harness sha256
`3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467`), reported in
`results/round7-comparison.md`. The before side did not change (it is a clean `git archive HEAD` of the same
commit); the after side was re-measured because the working tree moved after round 6 (`env.srcTree
43c627558ce2…` → `a3312e9248c3…`, 11 → 12 files, with `src/file-mentions.ts` now deduplicating the draft read and
`src/main.ts`'s prompt-fit unit moved above `renderComposer`). That file supersedes the round 1–6 pairs and
documents, none of which is kept here (see [Results on disk](#results-on-disk)); numbers from different harness
revisions are never mixed.

## Provenance (which script measured which tree)

Every JSON now carries, in the `env` block — and every run prints it before starting a browser:

| field | meaning |
|---|---|
| `harness` | sha256 of `run.mjs` itself, the file that produced the numbers |
| `harnessPath` | its absolute path |
| `commit` | `git rev-parse HEAD` of the served tree's expected commit |
| `srcTree` | sha256 of the served tree's `git diff` against that commit (empty diff = the commit's own tree) |
| `srcTreeFiles`, `srcTreeStat`, `srcTreeClean` | the modified file names, `--shortstat`, and whether the tree is clean |
| `worktree` | `{ path, source, hasGit, commit, verifiedBy, nodeModules }` for the tree the dev server served |
| `browser`, `raster`, `launchArgs`, `rasterArgs` | the raster mode and the exact Chromium flags for each |

`env.harnessPath` and `env.worktree.path` are the absolute paths of the machine that ran the harness. They are
provenance — proof of which checkout and which tree the numbers came from — not configuration: nothing reads
them back, and they say nothing about where the harness runs next.

`--worktree <path>` verifies before it measures and **fails loudly** otherwise:

* a tree with its own `.git` must be at `--expect-commit` (default: this checkout's `HEAD`), checked with
  `git rev-parse HEAD`;
* a `git archive HEAD` tree has no `.git`, so its content is checked with
  `git --git-dir=<this checkout>/.git --work-tree=<path> diff --quiet <commit>` and the offending file
  names are printed when it differs;
* the harness never writes there — no checkout, no reset, no index refresh; only `node_modules` is
  symlinked in when missing (`--no-link-deps` to forbid even that).

This is why the two JSONs in `results/` from before this hardening cannot prove anything by themselves:
they were written by an earlier revision of `run.mjs` and record no harness hash. Regenerate the pair with
the commands above; do not mix a number from one with a number from the other.

## What it measures

* **Frame interval p50/p95/p99/max** while assigning `scrollTop` at a nominal 3 000 px/s for 2 s in
  `requestAnimationFrame` steps (~120 frames; the measured rate is `mainScroll.achievedPxPerSec`), with a gap
  over 34 ms (two vsync slots) counted as a dropped frame.
* **Long tasks** (`PerformanceObserver` type `longtask`) overlapping each window: count and total ms.
* **Keystroke latency**: 40 characters typed as real key events (`keyboard.type`, 30 ms apart) into
  the composer; per keystroke, the time from the `input` event to the first animation-frame callback
  after it — the frame that paints the character. p50/p95/max and the count over 34 ms.
* **`slowEvents`** (`mainTyping.slowEvents`, also `btwTyping.slowEvents`): the number of keystrokes whose
  Event Timing entry is at or above 16 ms — the entries the browser only reports when a keystroke took
  longer than a frame. It is a first-class summary field, printed per state and in the on/off deltas,
  alongside `slowShare` (fraction of the 40 keystrokes) and `slowMaxMs`.
* **Main-thread busy time** (Chromium, CDP `Performance.getMetrics`): `TaskDuration` inside each
  window split into script / layout / style / paint, plus `busy % = TaskDuration / window`. On a fast
  machine every frame interval is 16.7 ms whether the main thread is idle or saturated, so this is
  the metric that separates the two cases; `paintMs` is the residual and dominates here.
* **Real wheel input** (`mainWheel`, `btwWheel`): the reader's own scroll, moved the way a reader moves it —
  `page.mouse.move()` to a point over `#transcript` / `.btw-transcript` (recorded as `point`, `pointHit`,
  `pointOverMessage`), then real `page.mouse.wheel()` notches every `--wheel-gap` ms for the same
  `--scroll-ms` window the `scrollTop` cell uses, over the same seeded thread, parked at the same 10 % of
  the scroller. Each notch is sized by a ramp that follows the distance the programmatic cell actually
  travelled, so the two scroll cells cover the same ground — a fixed 120 px notch every 40 ms delivers
  fewer than 50 notches in 2 s (each dispatch costs more than the gap) and used to leave this cell
  ~1 200 px short. It reports the same frame pacing, long tasks, main-thread split and `skyFramesDelta`,
  plus: `wheelTicks` / `trustedTicks` / `driverTicks` (notches the page saw, how many were `isTrusted`,
  notches the driver managed to dispatch), `nominalPxPerSec` (the step/gap intent) and
  `achievedPxPerSec` (distance / measured window) with `targetDistancePx` / `deliveredPx` /
  `distanceVsProgrammatic` (the ramp and its residual, so the two cells' comparability is measured, not
  asserted), `distancePx` / `endDistancePx` / `travelPct` / `startTop` / `endTop` / `peakTop` /
  `maxScrollTop` (so a window that fails to scroll is visible, not a silent pass), `scrolled` / `atTop` /
  `nearBottom` (it must reach a scrolled position, not sit at an edge), `resumeFrames` (sky frames in the
  second after the reader stopped — a hold must not be a stop) and `slowEventsAll` (Event Timing entries
  ≥ 16 ms of any type in the window). There is no `slowWheel` count: Event Timing has no `wheel` entry
  type, so one could only ever report 0; the `btwWheel` cell measures the side-thread gesture instead.
* **What the labels mean.** `cells`/`cellKinds` in the JSON name every cell's driver: `mainScroll` and
  `btwScroll` are **synthetic** (a `scrollTop` write arms no hold, so their cost is the floor the fix
  leaves), `mainWheel`, `btwWheel`, `mainTyping` and `btwTyping` are **reader** input (trusted browser
  events, the owner's gesture) and `mainStream` is **app**-driven (the bottom pin). A verdict that uses a
  synthetic cell to argue about a reader gesture is wrong; the comparison document keeps the two apart.
* **Render scale, disclosed per cell.** The sky paints at `SCALE` 0.6, or at `LOW_SCALE` 0.45 when its
  governor trips on a slow `gpuMs` (> ~24 ms). Every cell record carries `skyScale`
  (`{ values, min, max, uniform }`) and `skyGpuMs`, and `summary.<state>.scale` lists the value each repeat
  ran at (`perCell`). A before/after pair measured at different quality is not like-for-like; round 7 ran
  every `on` cell at 0.6 on both sides, and discloses the one 0.45 repeat (before side, GPU `css-off`) in
  `results/round7-comparison.md` §8.
* **Why the wheel cell exists, and why `scrollTop` cannot replace it:** the sky's reader-input hold is armed by
  `wheel`, `touchmove`, `pointerdown`, `keydown` and `input` — reader *events* — and by nothing else.
  Assigning `scrollTop` (the `mainScroll` cell, the app's own bottom pin, `scrollIntoView`) fires no event at
  all, so the hold never arms there and `skyFramesDelta` cannot show what the fix does to a scroll. That is
  not a flaw in the fix: the hold reads events, never the scroll position, so a `scrollTop` assignment —
  including the app's own pin — is invisible to it by construction. It is a reason to measure the reader's
  input directly.
* **The streaming window** (`mainStream`): `data-running` set on `#transcript`, a reply that grows every
  frame through a text node, and `scrollTop = scrollHeight` on every frame — the app's own pin, which is
  exactly the scroll the hold in `src/sky-window.ts` must not treat as reader input: the hold is armed by
  `wheel` / `touchmove` / `pointerdown` / `keydown` / `input` events, lasts 150 ms past the last of them, and
  never reads the scroll position, so a per-frame `scrollTop` assignment cannot arm it. Reports frame pacing
  over the window, `skyFramesDelta` (WebGL frames the sky painted during it), `running`, `wind` and `skyState`, and `pinnedFrames`/`bottomGapPx` so the pin is
  provable rather than assumed. The contract is that a run keeps its wind, so `skyFramesDelta` must be
  well above 0 here even though the transcript is being scrolled every frame.
* **The sky's own numbers**: `window.__sky` (`frames`, `scene`, `gpuMs`, `timing`, renderer string)
  plus idle frames per second, so "sky on" is proven on (`data-gl`, `data-sky-state="idle"`, 8 fps at
  rest) and "sky off" proven off (`data-gl` absent, `frames` frozen at 0).

Kept out of every window: a 600 ms warm-up scroll per scroller, so the seeded markdown's first paint
is not counted as scroll cost.

### Why `slowEvents` is the metric that moves and keystroke p95 is not

`mainTyping.p95` starts its clock at the `input` event — i.e. *after* the browser has dispatched the key
and the page has begun handling it. Everything that delays reaching that point (input dispatch, the
compositor's work before the event is delivered, the frame the key lands in) is invisible to it, and on
this machine it sits at 15–17 ms in every state: one frame, sky or no sky.

Event Timing's `duration` is measured from the keypress to the end of the rendering update it caused,
so it includes dispatch and everything before the field ever sees the character. That is why the same
keystrokes split cleanly: pre-fix, software raster, **40 of 40 keystrokes were ≥ 16 ms with the sky
on against 14.5 with it off**; post-fix it drops to **15.5 against the 11 sky-off control** (round 7,
×1.41 — a small tail, not parity). The GPU does not split cleanly: its slow count is 20.5 on against 19.5 off before
(no sky cost to remove) and 15.5 against 9 after, but that control median comes from repeats 9 / 15 / 9 / 0 (one
clean repeat) while the after-side `on` repeats are 13 / 15 / 16 / 16 and `css-off` is higher still at 18.5 — so the
ordering is not monotone in the sky and the GPU win is main-thread busy 27.16 → 18.19 against 19.07, not the slow-event
median. The latency win is the software row.
Read `slowEvents`
(and `slowShare`) first; treat p95 as a floor that only shows a stall once it is larger than a frame.


### Seeded load

200 turns → **450 seeded rows** (`config.seededRows`: 200 user prompts, 200 assistant replies with a heading, inline
code, a 12-line fenced TypeScript block, a list and a quote, plus 50 tool cards), which the transcript renders as
`counts.transcriptMessages` **400** message elements in `counts.transcriptRows` **402** rows → `#transcript` is
**62 062 px** tall at 1440×940 (`counts.transcriptScrollHeight`, identical in all 48 cell records of the round-7 pair).
The BTW panel
renders the same rows in its narrow column: **402 rows** (`btwCounts.btwRows`, identical in all 48 records) and a
column height that is not one number — `btwCounts.btwScrollHeight` spans **146 464–146 803 px** across those records
(146 464–146 803 before, 146 464–146 802 after), while the scroll cell itself reads `.btw-transcript` at
`scrollHeight` **146 166 px** in every cell of both runs. Quote the range, not a sample. The seed reaches the side
thread by answering `get_messages` for the session whose title starts with `BTW` (the `/btw …` step creates it), so
both panes hold identical content.

## Baseline (measured 2026-11-09, this machine)

> **Provenance note.** These tables were produced by an earlier revision of this script, before the JSON
> recorded `env.harness`; the run predates the `css-off` state and the streaming cell, so the tables below
> cover `on` and `off` only. They are kept as the historical pre-fix measurement. To produce a pair that
> proves *which* script measured *which* tree, use the two commands in [the honest before/after
> pair](#the-honest-beforeafter-pair); do not mix a number from here with a number from a later JSON.
>
> **Superseded for the sky fix.** The current pair is `results/before6.json` → `results/after7.json`
> (harness `3f049e10…`, seven cells: `mainScroll`, `mainWheel`, `mainTyping`, `mainStream`, `btwScroll`,
> `btwWheel`, `btwTyping`); its report is `results/round7-comparison.md`, which re-measures the after side on the
> tree now on disk. The tables below remain the historical pre-fix baseline and have no `mainWheel`, `btwWheel`
> or `css-off` row.

Environment: 13th Gen Intel i5-13600K, NVIDIA RTX 3060, Node 26.13.0, Playwright 1.63.0 (Chromium
153), viewport 1440×940, `?sky=12:00&scene=sky`, 4 repeats per sky state, medians.

Each figure is the median over the least-contended repeats: those whose main-thread cost is within
35 % of the best repeat in their own sky group (interference can only add work, never remove it).
Dropped repeats stay in the JSON, and the harness waits for the 1-minute load average to fall under 2
before each cell. `raster=gpu` is the machine's real GPU (ANGLE/GL, `ANGLE (NVIDIA Corporation,
NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)`). `raster=software` forces CPU compositing and
raster (`--disable-gpu --disable-gpu-compositing`, WebGL falls back to SwiftShader) — the shape of a
WebKitGTK window whose GPU path failed, and the mode that reproduces the complaint.

### sky scene ON

| raster | series | p50 | p95 | p99 | max | gaps > 34 ms | long tasks | main busy |
|---|---|---|---|---|---|---|---|---|
| gpu | mainScroll | 16.7 | **16.7** | 16.8 | 16.8 | 0 | 0 / 0 ms | **35.40 %** |
| gpu | mainTyping | 4.15 | **16.55** | — | 17.35 | 0 | 0 / 0 ms | **27.98 %** |
| gpu | btwScroll | 16.7 | 16.75 | 16.8 | 16.8 | 0 | 0 / 0 ms | 46.15 % |
| gpu | btwTyping | 4.95 | 16.7 | — | 17.7 | 0 | 0 / 0 ms | 34.06 % |
| software | mainScroll | 16.7 | **50.0** | 50.1 | 50.1 | 14.5 / 2 s | 5 / 251 ms | **58.04 %** |
| software | mainTyping | 4.5 | **18.9** | — | 20.2 | 0 | 0.5 / 25 ms | **55.02 %** |
| software | btwScroll | 16.7 | 41.7 | 50.05 | 50.05 | 5 / 2 s | 4.5 / 228 ms | 69.52 % |
| software | btwTyping | 5.1 | 20.2 | — | 24.85 | 0 | 1 / 51 ms | 59.03 % |

### sky scene OFF (identical seed, interleaved in the same run)

| raster | series | p50 | p95 | p99 | max | gaps > 34 ms | long tasks | main busy |
|---|---|---|---|---|---|---|---|---|
| gpu | mainScroll | 16.7 | **16.75** | 16.8 | 16.8 | 0 | 0 / 0 ms | **20.00 %** |
| gpu | mainTyping | 2.75 | **15.7** | — | 17.25 | 0 | 0 / 0 ms | **18.39 %** |
| gpu | btwScroll | 16.7 | 16.8 | 16.8 | 16.8 | 0 | 0 / 0 ms | 33.82 % |
| gpu | btwTyping | 3.95 | 16.55 | — | 17.95 | 0 | 0 / 0 ms | 24.83 % |
| software | mainScroll | 16.7 | **16.75** | 16.8 | 16.8 | 0 | 0 / 0 ms | **21.79 %** |
| software | mainTyping | 2.9 | **15.9** | — | 16.75 | 0 | 0 / 0 ms | **19.88 %** |
| software | btwScroll | 16.7 | 16.7 | 16.8 | 16.8 | 0 | 0 / 0 ms | 33.35 % |
| software | btwTyping | 4.05 | 14.35 | — | 14.55 | 0 | 0 / 0 ms | 25.45 % |

### sky on / sky off

| raster | metric | on | off | ratio |
|---|---|---|---|---|
| gpu | mainScroll busy % | 35.40 | 20.00 | **1.77×** |
| gpu | mainScroll main-thread work over the 2 s window | 727.8 ms | 412.9 ms | **1.76×** |
| gpu | mainScroll paint share of that work | 723.5 ms | 410.4 ms | 1.76× |
| gpu | mainScroll script share of that work | 4.3 ms | 2.5 ms | — |
| gpu | mainTyping busy % | 27.98 | 18.39 | 1.52× |
| gpu | btwScroll busy % | 46.15 | 33.82 | 1.36× |
| gpu | btwTyping busy % | 34.06 | 24.83 | 1.37× |
| software | mainScroll p95 | 50.0 ms | 16.75 ms | **2.99×** |
| software | mainScroll busy % | 58.04 | 21.79 | 2.66× |
| software | mainTyping busy % | 55.02 | 19.88 | 2.77× |
| software | btwScroll p95 | 41.7 ms | 16.7 ms | 2.50× |
| software | btwTyping busy % | 59.03 | 25.45 | 2.32× |

**The complaint reproduces.** With the sky scene on, a 2 s scroll of the same transcript costs
**1.77× the main-thread time** even on the GPU path (728 ms vs 413 ms — 15.4 points of busy, almost
all of it paint), and typing in the composer costs **1.52×**. On the CPU-compositing path the sky
eats the frame budget outright: p95 50 ms, ~14 dropped frames and 251 ms of long tasks per 2 s,
against a clean 16.7 ms with no dropped frame and no long task when the sky is off.

Spread across repeats (per-repeat `mainScroll` busy %, from the JSON): GPU sky on 37.2 / 34.9 / 35.9 /
33.9, GPU sky off 21.2 / 20.3 / 19.7 / 19.7 — no overlap. Software sky on 57.3 / 58.8 / 56.9 / 59.6,
software sky off 22.6 / 20.8 / 21.0 / 24.1 — no overlap either.

Two honest qualifications:

* On the GPU path the frame intervals stay at 16.7 ms either way — the machine has headroom, so the
  extra paint never misses a vsync. The busy column is what shows the cost there; a slower machine or
  a slower compositor turns that headroom into the dropped frames the software rows show.
* The BTW panel is **not** smoother than the main thread in this harness: it is slower in absolute
  main-thread terms (46.15 % vs 35.40 % busy with the sky on, because its 146 464–146 803 px column repaints
  more per scrolled pixel) and it takes the same relative sky penalty (1.36×). What is smooth in the
  report is its frame pacing, and that matches: 16.7 ms p95 in every GPU row.

## Where the cost is (the `css-off` state)

The `css-off` state keeps the WebGL canvas painting but removes `data-scene` from `.workspace`, which
switches off the sky's CSS treatments in `src/sky-window.css`: `text-shadow` on `#transcript`, the
`filter: drop-shadow` on every `.icon` inside it, the composer's `backdrop-filter: blur(22px) saturate(1.25)`,
and the tile bar / mirror composer blurs in `src/thread-tiles.css`. It is measured in **every** run;
`--scene-css off` / `--no-scene-css` only name the treatment (recorded in `config.sceneCss`) and never
filter cells.

> **Superseded by round 7.** The table below is a round-2 one-off (`--repeats 3`, GPU only; its JSON is not
> kept here) and it predates the `mainWheel`/`btwWheel` cells, the side-thread hold and the CSS plain-fill
> split. The isolation the current pair measured is in `results/round7-comparison.md` §4: `css-off` keeps the canvas
> and the hold and removes only the CSS, so `on − css-off` is the CSS term and a before→after difference inside one
> state is what the fix did there. GPU `mainWheel`: CSS term 7.90 busy points before, -1.08 after; the fix is worth
> -8.04 in `on` but +0.94 with the CSS already removed — the win is the hold suppressing the frames the CSS made
> expensive, not either half alone. Software `mainWheel`: canvas term 31.84 before, 1.44 after; the fix is worth
> -29.60 even with the CSS removed, so there the hold carries it. The command and numbers below
> are kept as the historical isolation.

```bash
node bench/perf-lag/run.mjs --raster gpu --repeats 3 --no-scene-css \
  --out /tmp/perf-css-isolation.json
```

| sky | data-scene | mainScroll busy % | btwScroll busy % |
|---|---|---|---|
| on, canvas **and** sky CSS | on | 35.40 *(baseline)* | 46.15 *(baseline)* |
| on, canvas only | off | **19.45** | 50.06 |
| off (no canvas, no CSS) | off | 20.24 | 36.02 |

Two different costs, both real:

* **Main transcript:** the canvas costs nothing measurable — with it still painting but the sky CSS
  gone, the main thread returns to the sky-off level (19.45 % vs 20.24 %). The ~15 points of extra
  paint are the text shadow, the per-icon drop shadows and the composer blur being re-rastered during
  the scroll. `__sky.gpuMs` stays around 2–3 ms on the GPU, so the shader is not the main-thread cost.
* **BTW panel:** `data-scene` CSS does not reach the inspector, and the canvas alone still accounts
  for its sky penalty (50.06 % with the canvas, 36.02 % without). That points at layer/composite work
  over the canvas rather than at the CSS treatments; treat it as a measured difference with a
  hypothesis attached, not a proven cause.

## Options

```
node bench/perf-lag/run.mjs [options]

--raster gpu|software|both   default both
--scene-css on|off|both      default both; names the isolation's treatment and is recorded in the
                             JSON. Not a cell filter — on, off and css-off are always measured
--no-scene-css               alias for --scene-css off
--worktree <path>            serve another tree of the same commit (e.g. a `git archive HEAD`
                             extraction) instead of this checkout; verified and never written
--expect-commit <sha>        the commit --worktree must be at; default: this checkout's HEAD
--no-link-deps               do not symlink node_modules into a --worktree without one
--dry-run                    print provenance and config, verify --worktree, start nothing
--repeats <n>                default 2 (the baseline above used 4)
--messages <n>               default 200 turns
--scroll-ms <n>              default 2000
--scroll-speed <n>           default 3000 px/s, the programmatic cell's *nominal* speed (measured:
                             mainScroll.achievedPxPerSec); the BTW panel uses half
--wheel-step <n>             floor for a wheel notch, default 120 px (mainWheel cell); the actual notches
                             ramp up from it to cover the programmatic cell's distance
--wheel-gap <n>             default 40 ms between notches; step/gap is the nominal px/s only
--wheel-max-step <n>        largest single notch the ramp may send, default 4 x wheel-step
--chars <n>                  default 40
--type-delay <n>             default 30 ms between keystrokes
--stream-ms <n>              default 2000; the streaming window
--stream-chunk <n>           default 24 chars appended per frame while streaming
--max-load <n>               default 2; wait for the 1-minute load average to come down first
--load-wait <s>              default 180; give up waiting after this
--port <n>                   default 1420
--no-server                  never start a dev server; fail if none is listening
--browser chromium|webkit    default chromium
--out <path>                 default results/baseline.json
```

The JSON (`--out`, default `results/baseline.json`):

```
{ generatedAt, url,
  env { harness, harnessPath, commit, srcTree, srcTreeFiles, srcTreeStat, srcTreeClean,
        worktree { path, source, hasGit, commit, verifiedBy, nodeModules },
        node, browser, raster, playwright, viewport, cpu, loadavgAtEnd, … },
  config { raster, states, sceneCss, launchArgs, rasterArgs, messages, seededRows, scrollMs,
           scrollSpeedPxPerSec, wheelStepPx, wheelGapMs, wheelSpeedPxPerSec, streamMs,
           streamChunkChars, chars, typeDelayMs, repeats, devServer, worktree, … },
  modes: { gpu | software: {
    renderer: the app's own WEBGL_debug_renderer_info string,
    summary: { on: { mainScroll, mainWheel, mainTyping, mainStream, btwScroll, btwWheel, btwTyping,
                     scale { values, min, max, uniform, gpuMsMedian, perCell } }, off: { … },
               css-off: { … } },
    deltas: { mainScroll: { p95: { on, off, ratio, delta }, busyPct: { … },
                            keystrokes, slowEvents, slowShare, skyFrames, … }, … },
    deltasSceneCss: same shape, sky on vs scene-css off (always present: the css-off cell is not optional),
    cells: every cell's label, cellKinds: synthetic | reader | app,
    runs: [ { sky, state, repeat, raster, rejected, loadavg, counts, btwCounts, sceneCss,
              skyBefore, skyAfter, skyFramesIdle, renderScale { windows, gpuMs, values },
              mainScroll { p50, p95, p99, max, over25, over33, over34, frames,
                           longTasks { count, totalMs, max },
                           skyFramesDelta, sceneCss, scrollHeight, clientHeight, span,
                           startTop, endTop, distancePx, maxScrollTop, windowMs,
                           nominalPxPerSec, achievedPxPerSec,
                           mainThread { taskMs, busyPct, scriptMs, layoutMs, styleMs, paintMs } },
              mainWheel { …as mainScroll…, slowEventsAll, slowEventsAllMaxMs, resumeFrames,
                          wheelTicks, trustedTicks, driverTicks, wheelDeltaPx, deltaModes, firstTicks,
                          startTop, endTop, peakTop, maxScrollTop, distancePx, endDistancePx, travelPct,
                          nominalPxPerSec, achievedPxPerSec, targetDistancePx, deliveredPx,
                          distanceVsProgrammatic,
                          scrolled, atTop, nearBottom, windowMs, point, pointHit, pointOverMessage },
              mainTyping { p50, p95, max, keystrokes, over25, over33, over34, slowEvents, slowShare,
                           slowMaxMs, longTasks, sceneCss, mainThread },
              mainStream { p50, p95, p99, max, over25, over33, over34, frames, longTasks,
                           skyFramesDelta, running, wind, skyState, pinnedFrames, bottomGapPx,
                           streamedChars, streamedFrames, busyPctPerFrame, busyPctPer1kChars,
                           taskMsPerFrame, taskMsPer1kChars, sceneCss, mainThread },
              btwScroll, btwWheel, btwTyping } ] } },
  pageErrors }
```

`summary.<state>` holds the medians over the least-contended repeats, so `slowEvents` there is the median
count of ≥ 16 ms keystrokes per state — the figure to compare before and after a fix.

## Caveats

* **Not WebKit.** The real window is WebKitGTK. Playwright's WebKit 26.6 downloads but cannot run on
  this Arch box (`npx playwright install webkit` → *"Host system is missing dependencies … libicu74,
  libxml2, libflite1"*; `webkit.launch()` refuses). Chromium stands in: same-idea paint paths, a
  different compositor. The `raster=software` rows are the closest available proxy for a WebKitGTK
  window compositing on the CPU — a stress mode, not WebKit's numbers.
* **Not the Tauri backend.** Everything runs on the Vite dev server with `src/preview.ts` as the
  backend (preview mode is automatic outside Tauri), so Rust-side work is out of scope by design.
* **The streaming cell is synthetic but the pin is the app's**: `scrollTop = scrollHeight` every frame,
  which is what `main.ts` does while a run writes. The text grows through a text node (24 chars a frame) —
  a real token stream differs in size and in how much of the transcript it re-renders, so read
  `skyFramesDelta` (does the run keep its wind?) and the over-34 count, not the absolute busy %.
* **`--worktree` writes exactly one thing**, and only when the tree has no `node_modules`: a symlink to
  this checkout's, untracked and gitignored, reported in `env.worktree.nodeModules` (`--no-link-deps`
  forbids it). Nothing else in that tree is created or modified, and no git command writes there.
* **`mainScroll` is synthetic, `mainWheel` is not.** The scroll cell assigns `scrollTop` per frame at a
  nominal 3 000 px/s (measured rate in `achievedPxPerSec`): no fling physics, no wheel deltas, so
  `#transcript`'s wheel handler never loads older pages there, and — the point of the wheel cell — no reader
  event, so the sky's hold never arms. The wheel cell drives real `page.mouse.wheel()` notches, records
  `isTrusted` on every event, and would fail loudly if a window received none; its notches start at a mouse
  wheel's 120 px and ramp up to cover the same distance as the programmatic cell, so it is real wheel input,
  not a trackpad's pixel deltas.
* **The machine is shared.** It also runs the owner's desktop and other agents; whole-run load spikes
  hit the `software` rows hardest (one repeat stalled for 1.8 s on somebody else's build). The
  least-contended estimator and the load gate keep that out of the medians, but rerun rather than
  trust a single cell if `loadavg` in the JSON is high.
* **`npm install` may rewrite `package-lock.json`.** It did not here (checked with
  `git diff --stat package-lock.json`).
* **An empty `$HOME/package.json` breaks vite.** With `~/package.json` present and 0 bytes, `vite`
  dies in dependency prebundling with `Unexpected end of file in JSON` before the dev server answers,
  so `npm run dev` and `playwright test` fail too — not only this harness. The harness warns on
  startup if it is back. It was moved aside to `/tmp/stray-home-package.json.bak` for this baseline.
* **The round-7 pair leaves measured software-raster residuals.** On the GPU the reader wheel is *below* its own
  sky-off control — 22.12 → **14.08 %** busy against 15.16 — but that is a floor that moved, not a measured speedup:
  after the fix every GPU `on` cell sits at or below its `off` control, so read a GPU ratio below 1 as "at control"
  (`round7-comparison.md` §4). On software the transcript wheel is still **1.08×** its control (52.31 → **16.82 %**
  against 15.58, +1.24 busy points); typing slow events go 40 → **15.5** of 40 (control 11, ×1.41), and on the GPU
  20.5 → **15.5** of 40 (control 9, ×1.72 — but that control median comes from repeats 9 / 15 / 9 / 0, and the
  `css-off` state is higher still at 18.5, so the ordering is not monotone in the sky). Three cells are not at control
  at all: streaming costs **53.53 % per 1k chars against 8.30** (×6.45), the app-driven transcript scroll costs
  **49.68 % vs 21.32 %** busy (×2.33), and the side thread's synthetic scroll **57.77 % vs 34.39 %** (×1.68). All
  three are cells a hold cannot arm on (a `scrollTop` write fires no reader event). Do not read the numbers here as
  "fixed everywhere"; `results/round7-comparison.md` §6 lists every residual and §7 the full wrong-way scan, with
  their sizes, and §3.4 sizes the round-6→7 tree delta (the typing movement there is the box's drift, not the
  mentions dedup).
* Numbers are one machine on one day. Compare runs on the same machine and prefer the ratios when
  the hardware changes.

## Results on disk

`results/` is generated output, and it holds only what the current comparison document was written from:

| file | kept because |
|---|---|
| `before6.json`, `after7.json` | the pre-fix / post-fix pair from one harness revision (`env.harness` = `3f049e10…` in both); every number in `round7-comparison.md` comes from these two. `before6.json` is the clean-HEAD half and did not change; `after7.json` is the after side re-measured on the tree now on disk |
| `round7-comparison.md` | the newest comparison document, and it cites no other file |

Deleted with the rounds they belonged to. Each is reproducible from the commands above, so nothing was
archived:

* `baseline.json`, `baseline-prefix.json` — the first baseline and its copy, written before a JSON recorded `env.harness`.
* `before.json`, `after.json` — the round-1 pair, from a harness revision with no wheel cell.
* `after-fix.json`, `after-fix-visual-check.json` — round 1's post-fix run and its computed-style probe.
* `css-only-isolation.json` — the one-off `css-off` run behind the isolation table above.
* `round2-comparison.md`, `round2-visual.json`, `round2-visual.mjs`, `round2-*.png` (4) — round 2's document, its computed-style probe, its script and its screenshots, all superseded by `round7-comparison.md`.
* `before5.json`, `after5.json`, `round5-comparison.md` — round 5's pair and report, from the 6-cell harness (harness `ddc366e6…`, no `btwWheel`, a `slowWheel` field that could only be 0); superseded by the round-6 pair, which measures the side wheel instead of counting a type Event Timing does not report.
* `after6.json`, `round6-comparison.md` — round 6's after-side JSON and report, from the same harness and commit but the older 11-file tree (`env.srcTree 43c627558ce2…`); superseded by `after7.json` and `round7-comparison.md`, which re-measure the tree now on disk. Round 6's numbers survive only in `round7-comparison.md` §3.4, which quotes them for the round-6→7 delta.
* every pair and comparison document between round 2 and the current one — superseded by `round7-comparison.md` and pruned with it, the same way as the round-2 files above.
* `after-fix-comparison.md`, `after-fix-*.png` (3), `visual-check.mjs` — round 1's document, its screenshots and the one-off script that took them.

Both helper scripts lived in `results/` and are deleted, not moved: they were one-off visual probes tied to
those screenshots, nothing in `run.mjs` calls them, and their only outputs were the PNGs removed with them.

## Checks performed

These are the historical checks, run while hardening the harness (single short cells, not the baseline).
The round-7 pair and the checks that produced the current numbers are at the end of this section.

* `node bench/perf-lag/run.mjs --dry-run` and `… --dry-run --worktree /tmp/perf-prefix` — provenance
  prints, `srcTree` = `e3b0c442…` (empty diff) for the pristine `git archive HEAD` tree, and a tampered
  file in that tree made the run exit 1 with `… differs from commit 6b94bf1… (src/sky-window.ts)`.
* `node bench/perf-lag/run.mjs --raster gpu --repeats 1 --port 1463 --out /tmp/perf-smoke.json` — one
  `on` / `off` / `css-off` cell each on the current checkout: sky frames painted during the 2 s scroll
  16 / 0 / 17; `slowEvents` 15 / 14 / 19 of 40 (`--scene-css` default). The streaming cell as first
  written measured its own DOM work (busy ~99 %), which is why the growth now goes through a text node.
* `node bench/perf-lag/run.mjs --raster gpu --repeats 1 --scene-css on --port 1464 --out
  /tmp/perf-smoke2.json` — the corrected streaming cell, sky on vs off: `mainStream` p95 **16.8 ms /
  16.8 ms**, over-34 **0 / 0**, **`skyFramesDelta` 59 / 0**, `wind` `1` / absent, `skyState` `moving` /
  `off`, `pinnedFrames` 120 / 120 at `bottomGapPx` 0. Scrolling in the same run: p95 16.8 / 16.7,
  busy 17.97 % / 22.40 %, sky frames 16 / 0; typing `slowEvents` 23 / 15 of 40, busy 18.89 % / 20.39 %.
  `pageErrors` empty. (That run was made while `--scene-css on` still filtered states to two; it no
  longer does, and `--dry-run --scene-css on` now prints `states on / off / css-off`.)
* `node bench/perf-lag/run.mjs --dry-run --scene-css on` and `--dry-run --worktree /tmp/perf-prefix`
  after the change: three states in both, `srcTree` `e3b0c442…` for the pristine tree, and
  `--scene-css nonsense` exits 1 with the expected-values message.
* Older runs that the tables above came from: `--repeats 4` (16 cells, `pageErrors` empty),
  `--raster gpu --repeats 3 --no-scene-css`, and `--port 1437 --raster gpu --repeats 1` (the harness
  started and stopped its own dev server).
* Assertions the run enforces: more than 100 `#transcript .message` rows drawn, more than 100
  `.btw-transcript [data-message-id]` rows after the `/btw` step, composer focus taken before typing,
  no `send_message` before the `/btw` step, `data-running` still on `#transcript` throughout the
  streaming window, `--worktree` content equal to the expected commit (or the run exits non-zero), and
  `skyBefore`/`skyAfter` recorded so on (`data-gl`, 8 idle fps) and off (`frames` at 0) are visible in
  the JSON. The wheel cell adds two more: the point it puts the cursor on must be inside `#transcript`
  (it throws with the element it found instead, e.g. `… would land on div.composer-area, not inside
  #transcript`), and a wheel window that received no `isTrusted` wheel event over `#transcript` throws
  rather than reporting a scroll that never happened.

### The seven cells and the round-7 pair (harness `3f049e10…`)

* `sha256sum bench/perf-lag/run.mjs` — `3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467`,
  the same hash both JSONs record in `env.harness`: one script wrote both.
* `git rev-parse HEAD` — `6b94bf1d8b579d08834578f6e24684ea0d3fccbd`, the same `env.commit` in both JSONs.
* The tree hash, recomputed the way the harness computes it (`git diff --no-color --no-ext-diff 6b94bf1d… --`
  in the checkout, `.trim()`, sha256) — `a3312e9248c3eaf2d10e9d4a55cd49684c4b042ed9fc113ca9fa919e5d970ae4`,
  equal to `env.srcTree` in `after7.json`, over 12 files / `12 files changed, 1072 insertions(+), 53 deletions(-)`.
  Measured before the run, printed by the run's provenance block and re-checked after it: the same value three
  times, so the diff on disk is the diff that was measured. (This is not `git diff | sha256sum`: the raw pipe
  keeps the trailing newline the harness trims, and hashes to a different value.)
* The full after run: `node bench/perf-lag/run.mjs --repeats 4 --out bench/perf-lag/results/after7.json` — 24 cell
  records (3 states × 4 repeats × 2 rasters), seven cells in every state on both rasters, `pageErrors: []` and
  `errors: []` in all 24, no repeat rejected by the least-contended estimator, and the wheel cells delivered
  0.98–0.99 of their programmatic twin's distance in every state of both rasters (the harness warns below 0.9 and
  the report treats that as a failed cell). The before side is `results/before6.json`, unchanged from round 6
  (clean `git archive HEAD`, `env.srcTree` = the empty tree), so it was not re-run.
* Renderer: `modes.gpu.renderer` is
  `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)` and `modes.software.renderer` is
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` in both JSONs;
  `nvidia-smi` reports the `NVIDIA GeForce RTX 3060` directly (driver 615.78.08), so the GPU raster is not
  SwiftShader wearing a name.
* Quiet box: `ss -ltnp | grep 1420` was empty before the run (no dev server to kill), and the run's per-cell
  1-minute load gate (≤ 2) held — observed max 1.94 after. The 5- and 15-minute averages still carried earlier
  worker runs (5.91 / 8.55 at start), which is why the report leans on ratios and within-state comparisons.
* **The tree measured is the tree on disk.** Unlike round 6 — whose `after6.json` pinned 11 files while the
  checkout had moved on — `after7.json`'s `env.srcTree` equals the checkout's current diff. If the working tree
  changes again, re-run the after command before quoting any number in `round7-comparison.md`; the before side
  never needs re-running unless the commit moves.
