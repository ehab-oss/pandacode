# Perf-lag round 7 — the measured record of the 7-cell harness, re-taken on the tree that will be reviewed

Supersedes `round6-comparison.md`, which is pruned from this directory together with `after6.json` (the JSON its
after-side tables were read from) — this file and the pair below are now the only comparison record on disk. Two runs of
**one** harness revision (`bench/perf-lag/run.mjs`, sha256 `3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467`), each 3 states × 4 repeats × 2 rasters
(24 and 24 cell records), on one machine, one tree per run: `before6.json` serves the pre-fix commit
(`git archive HEAD` into `/tmp/perf-final6`), `after7.json` the working tree **as it is on disk now**. Every number
below is read out of those two JSONs and formatted by a script from the medians they store; nothing is carried over from
rounds 1–6, and where a number differs from round 6 the difference is named and sized (§3.4).

Why the after side was re-measured: `after6.json` pinned `env.srcTree = 43c627558ce2…` over 11 files, and the
tree has since changed in files that affect runtime — `src/file-mentions.ts` now memoizes the last read of the draft and
skips a repeat `refresh()` whose cheap reads (text, caret, context, composition, focus, editability, dismissal) did not
move, on the open *and* the closed path, with `reread()` dropping that memo on blur, composition start and a hidden
composer; `src/main.ts` moved the prompt-fit unit (`promptFit`/`promptResize`, declared before its first caller) above
`renderComposer()`; and `tests/wallpapers.spec.ts` is new, with comment/doc/test edits around them. The before side is
still valid: it is a clean `git archive HEAD` of the same commit, so only the after side needed re-measuring.

## 0. Provenance: one harness, one commit, two trees

| field | `before6.json` | `after7.json` |
|---|---|---|
| `env.harness` (sha256 of `bench/perf-lag/run.mjs`) | `3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467` | `3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467` |
| harness on disk now (`sha256sum bench/perf-lag/run.mjs`) | `3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467` — the script that wrote both JSONs is the script in the tree | same hash |
| `env.commit` (repo HEAD) | `6b94bf1d8b579d08834578f6e24684ea0d3fccbd` | `6b94bf1d8b579d08834578f6e24684ea0d3fccbd` |
| served tree | `/tmp/perf-final6` (`git archive HEAD \| tar -x`, no `.git`, node_modules linked) | `/home/ehab/audit-pandacode/src` (the checkout) |
| `env.srcTree` (hash of the uncommitted diff) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (the empty tree) | `a3312e9248c3eaf2d10e9d4a55cd49684c4b042ed9fc113ca9fa919e5d970ae4` |
| uncommitted files | none (`srcTreeClean: true`) | 12 files, `12 files changed, 1072 insertions(+), 53 deletions(-)`: `docs/agent-reference.md`, `src/file-mentions.ts`, `src/main.ts`, `src/sky-window.css`, `src/sky-window.ts`, `src/thread-tiles.css`, `src/turn-card.css`, `tests/file-mentions.spec.ts`, `tests/sky.spec.ts`, `tests/thread-tiles.spec.ts`, `tests/ui.spec.ts`, `tests/wallpapers.spec.ts` |
| tree verified how | `git --git-dir=/home/ehab/audit-pandacode/src/.git --work-tree=/tmp/perf-final6 diff --quiet 6b94bf1d8b579d08834578f6e24684ea0d3fccbd (content equals the commit)` | `git rev-parse HEAD in the served tree`; the diff hashed is the diff on disk (§0.1) |
| `env.serverReused` / `serverStarted` | `false` / `true` | `false` / `true` |
| dev server | `http://127.0.0.1:1420`, vite, one server per run, killed at the end | `http://127.0.0.1:1420`, same |
| URL measured | `http://127.0.0.1:1420/?sky=12:00&scene=sky` | `http://127.0.0.1:1420/?sky=12:00&scene=sky` |
| seeded workload | `config.messages` 200; `counts` 400 message elements in 402 rows; transcript `scrollHeight` 62062 px over the 24 cells (side thread opened by `/btw`, no fixture) | identical (400 / 402 / 62062 px; side thread 402 rows, `scrollHeight` 146464–146803 px) |
| 1-min load, run start | `[0.67, 9.83, 11.43]` | `[0.41, 5.91, 8.55]` |
| 1-min load, run end | `[3.8, 2.91, 5.88]` | `[1.87, 2.26, 4.74]` |
| 1-min load, per cell (24 cells each) | min 0.47, median 1.17, max 2 | min 0.41, median 1.5, max 1.94 |
| renderer, `--raster gpu` (from the app's own canvas) | `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)` | `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)` |
| renderer, `--raster software` | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` |
| `pageErrors` | `[]` (0, and `errors: []` in all 24 cell records) | `[]` (0, and `errors: []` in all 24) |
| rejected repeats (harness rule) | 0 of 24 cells | 0 of 24 |
| file size | 538743 B | 537770 B |
| written at (UTC) | `2026-11-09T23:24:06.157Z` (cells 23:10:20 → 23:23:34) | `2026-11-10T00:40:45.073Z` (cells 00:27:30 → 00:40:14) |

Shared environment: `13th Gen Intel(R) Core(TM) i5-13600K`, `linux/x64`, node `v26.13.0`, Playwright `1.63.0`,
Chromium headless, viewport `1440x940`, 3 states interleaved (order rotated per repeat), 4 repeats per state per
raster in both runs. Machine quieting: no vite/Chromium of this checkout was alive at either start (port 1420 free, `ss`
showed no listener), nothing of this checkout was killed because nothing of it was running, and the box was left to
settle until the 1-minute average was below 2 before the first cell: the after-side run began at
`[0.41, 5.91, 8.55]` — 1-minute 0.41, but the 5- and 15-minute averages
(5.91, 8.55) still carried earlier workers' runs (round 6's after run began at 1.91 /
5.12). The per-cell load gate (the harness waits for 1-minute ≤ 2 before every cell) is the condition each
measurement actually met; observed per-cell 1-minute max: 2 before, 1.94 after.

**The provenance claim, in one line:** both JSONs carry `env.harness = 3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467`
(equal to `sha256sum bench/perf-lag/run.mjs` right now) and `env.commit = 6b94bf1d8b579d08834578f6e24684ea0d3fccbd`
(equal to `git rev-parse HEAD`), and only `env.srcTree` differs — `e3b0c44298fc…` (clean tree at HEAD) vs
`a3312e9248c3…` (the 12-file working tree) — one script, one commit, two trees.

**No drift note this time.** Round 6 had to warn that the tree on disk was no longer the tree `after6.json` had
measured. `after7.json` pins the diff that was on disk when it ran, and that diff was still the diff on disk when this
sentence was written: recomputing the harness's own hash (`git diff --no-color --no-ext-diff 6b94bf1d8b57 --`,
trimmed, sha256) before the run, at the run's provenance line and after the run gave `a3312e9248c3eaf2d10e9d4a55cd49684c4b042ed9fc113ca9fa919e5d970ae4` all three times, over
the same 12 files and `12 files changed, 1072 insertions(+), 53 deletions(-)`. No file that affects runtime was written while the
cells ran.

### 0.1 The checks this record rests on

| check | result | value |
|---|---|---|
| `env.harness` equals `before6.json`'s | **PASS** | `3f049e10ae90e467692fe3f648923fa4a19243b66a057f8a1df7cba0c7f8a467` |
| `env.commit` equals `git rev-parse HEAD` now | **PASS** | `6b94bf1d8b579d08834578f6e24684ea0d3fccbd` = `6b94bf1d8b579d08834578f6e24684ea0d3fccbd` |
| `env.srcTree` equals the current `git diff HEAD` hash, computed the harness's way | **PASS** | recorded `a3312e9248c3eaf2…`, computed `a3312e9248c3eaf2…` |
| `pageErrors` empty (and no `errors` in any cell record) | **PASS** | 0 / 0 |
| 7 cells in every state, both rasters, both JSONs | **PASS** | 7/7/7/7/7/7 and 7/7/7/7/7/7 |
| `mainWheel` / `btwWheel` distance ≥ 0.9 of its programmatic twin (all states, both rasters, both JSONs) | **PASS** | after 0.98–0.99; before 0.96–0.99 |
| renderer is the RTX 3060 on the GPU raster | **PASS** | `RTX 3060` in both |

`env.srcTree` is recomputed the way the harness computes it — `git diff --no-color --no-ext-diff <commit> --` in the
served root, `.trim()`, sha256 — not the raw bytes of `git diff | sha256sum` (that hash is a different number: the raw
pipe keeps the trailing newline the harness trims). At generation time it is `a3312e9248c3eaf2d10e9d4a55cd49684c4b042ed9fc113ca9fa919e5d970ae4`, the same value `after7.json`
recorded at run time and the same value measured before the run, so the diff on disk is the diff that was measured.

## 1. The raster is honest

Both JSONs read the renderer string out of the app's own `WEBGL_debug_renderer_info` after the sky mounted
(`modes.*.renderer`, also `runs[].skyBefore.renderer`): the GPU raster renders on the **RTX 3060**, not SwiftShader.
The box reports the card directly (`nvidia-smi`: `NVIDIA GeForce RTX 3060`, driver 615.78.08) and the after-side run
returned the two strings below in every GPU cell, so the renderer line is not a single lucky sample:

- `--raster gpu` (`--use-gl=angle --use-angle=gl --enable-gpu --ignore-gpu-blocklist`): `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)` — the machine's real GPU.
- `--raster software` (`--disable-gpu --disable-gpu-compositing --disable-accelerated-2d-canvas --disable-features=CanvasOopRasterization`): `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` — SwiftShader, a stand-in for a WebKitGTK window whose GPU path fell back to CPU compositing.

The app is a WebKitGTK window natively (Chromium here, see §10); the software raster is not the owner's machine, it is
the *floor*: every "software" number below is what the same code does when the compositor has no GPU. The two rasters
answer different questions, and the fix behaves differently on them — that is the point of measuring both.

## 2. What the harness measures now: 7 cells, labelled by what drives them

| cell | kind | what drives it | what it reports |
|---|---|---|---|
| `mainScroll` | **synthetic** | `#transcript`, `scrollTop` advanced per frame at a nominal 3 000 px/s | frame pacing, long tasks, main-thread work, sky frames painted in the window |
| `mainWheel` | **reader** | `#transcript`, real `page.mouse.wheel`, one notch every 40 ms ramped to `mainScroll`'s distance | as `mainScroll` + trusted-event count, distance, where it ended |
| `mainTyping` | **reader** | `#prompt`, 40 real key events | keystroke latency, Event Timing slow events, main-thread work |
| `mainStream` | **app** | `#transcript[data-running]`, a reply growing every frame while the app pins to the bottom | frame pacing, normalized main-thread work, sky frames |
| `btwScroll` | **synthetic** | `.btw-transcript` (same seeded rows, narrow column) | as `mainScroll` |
| `btwWheel` | **reader** | `.btw-transcript`, real `page.mouse.wheel`, ramped to `btwScroll`'s distance | as `mainWheel`, on the side thread |
| `btwTyping` | **reader** | `.btw-input`, 40 real key events | as `mainTyping`, in the side composer |

The frame cells report `over25`, `over33` and `over34` (frames that missed one, two, or two-plus 60 Hz slots; `over33`
is the headline, `over34` is kept for continuity with older JSONs). Every cell carries its `kind` label and, beside it,
the sky's render `scale` and `gpuMs` for the repeat (`skyScale`, `skyGpuMs`), so a before/after pair measured at
different quality cannot hide it. A synthetic cell *arms no hold by design*: a position write fires no reader event,
which is why the software synthetic cells keep most of their cost after the fix while the reader cells do not; on the GPU
they lose it through the CSS term instead, which §4 separates. That difference is the mechanism, not a defect, and every
verdict below compares a reader cell against its own control **and** against the reader cell's synthetic sibling, never
the other way round.

## 3. Head-to-head

Reading the tables: **B** = `before6.json` (HEAD, no fix) and **A** = `after7.json` (working tree, fix).
`on` = canvas painting + scene CSS; `css-off` = canvas painting, `data-scene` removed — the canvas **and** the reader hold
stay, only the CSS goes; `off` = no canvas, no scene CSS (the control). `resumeFrames` in the JSON proves the gesture ran
in `css-off` (8 in `on` and 8 in `css-off`, 0 in `off`, on both rasters and both runs), and
after the fix `css-off` paints 1 sky frame in `mainWheel` and
0.5 in `btwWheel` on the GPU. Each column is the median of the kept repeats for that state on that raster
(4 in every state; nothing was rejected, §9).

`busy %` is CDP `TaskDuration` over the cell's window — the fraction of wall time the renderer's main thread was busy;
`work ms` is the same task time in ms; frame intervals are `requestAnimationFrame` deltas; `frames > 33 ms` counts frames
that missed two 60 Hz slots; long tasks are `PerformanceObserver('longtask')` entries inside the window; slow input
events count Event Timing `input` entries ≥ 16 ms (the observer's floor) — keypress to presented frame, which p95
keystroke latency does not see. A median of four even counts can land between two integers (e.g. 16.5). The
programmatic scroll cells record no Event Timing, so a slow-event row appears for the wheel and typing cells only.
`sky frames` is frames the sky painted inside the window; for a reader cell a *full-rate* count means the hold was not
covering it, while a frame or two (§4) means it was.

### gpu raster

**gpu raster — `mainScroll`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 34.63 | 17.99 | 17.72 | 20.09 | 19.58 | 20.9 | ×1.77 | ×0.86 |
| work ms (CDP TaskDuration) | 712.42 | 371.64 | 368.41 | 414.77 | 402.65 | 429.77 | ×1.77 | ×0.86 |
| paint ms | 708.16 | 367.36 | 364.54 | 410.22 | 400.25 | 427.19 | ×1.77 | ×0.86 |
| p95 frame interval ms | 16.75 | 16.7 | 16.7 | 16.7 | 16.8 | 16.8 | ×1 | ×0.99 |
| p99 frame interval ms | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | ×1 | ×1 |
| frames > 25 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| frames > 34 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| achieved px/s | 2984.39 | 2973.24 | 2973.24 | 2973.24 | 2985.87 | 2973.24 | ×1 | ×1 |
| nominal px/s | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| distance travelled px | 6000 | 6000 | 6000 | 6000 | 6000 | 6000 | ×1 | ×1 |
| sky frames painted in window | 16 | 16 | 16 | 17 | 0 | 0 | — | — |
| frames in window | 120.5 | 121 | 121 | 121 | 120.5 | 121 | ×1 | ×1 |
| mean fps | 60 | 60 | 60 | 60 | 60 | 60 | ×1 | ×1 |

**gpu raster — `mainWheel`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 22.12 | 14.08 | 14.22 | 15.16 | 14.16 | 15.16 | ×1.56 | ×0.93 |
| work ms (CDP TaskDuration) | 446.9 | 284.36 | 287.37 | 306.31 | 286.04 | 306.08 | ×1.56 | ×0.93 |
| paint ms | 432.83 | 269.82 | 273.08 | 291.27 | 273.57 | 291.98 | ×1.58 | ×0.92 |
| p95 frame interval ms | 16.7 | 16.75 | 16.7 | 16.7 | 16.7 | 16.7 | ×1 | ×1 |
| p99 frame interval ms | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | ×1 | ×1 |
| frames > 25 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| frames > 34 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| achieved px/s | 2935.79 | 2935.82 | 2937.28 | 2935.85 | 2935.81 | 2935.09 | ×1 | ×1 |
| nominal px/s | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| distance travelled px | 5898 | 5901 | 5902.5 | 5904 | 5899.5 | 5901 | ×1 | ×1 |
| sky frames painted in window | 16 | 0 | 16 | 1 | 0 | 0 | — | — |
| frames in window | 122 | 121.5 | 121.5 | 122 | 122 | 122 | ×1 | ×1 |
| mean fps | 60.75 | 60.5 | 60.47 | 60.69 | 60.73 | 60.7 | ×1 | ×1 |
| wheel notches dispatched (trusted) | 39 | 39 | 39 | 39 | 39 | 39 | ×1 | ×1 |
| slow input events, all (≥16 ms) | 77 | 80.5 | 72 | 74 | 69 | 73 | ×1.12 | ×1.1 |
| distance vs programmatic cell | 0.98 | 0.98 | 0.98 | 0.98 | 0.98 | 0.98 | ×1 | ×1 |
| resume frames after the wheel | 8 | 8 | 8 | 8 | 0 | 0 | — | — |

**gpu raster — `mainTyping`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| p50 keystroke ms | 3.65 | 2.9 | 4.5 | 3.85 | 7.95 | 2.8 | ×0.46 | ×1.04 |
| p95 keystroke ms | 16.15 | 16.15 | 15 | 16.25 | 16.25 | 14.6 | ×0.99 | ×1.11 |
| max keystroke ms | 17.8 | 17 | 15.35 | 17.1 | 17.15 | 16.15 | ×1.04 | ×1.05 |
| slow input events (≥16 ms) | 20.5 | 15.5 | 15.5 | 18.5 | 19.5 | 9 | ×1.05 | ×1.72 |
| slow share | 0.52 | 0.39 | 0.39 | 0.47 | 0.49 | 0.23 | ×1.06 | ×1.7 |
| busy % (renderer main thread) | 27.16 | 18.19 | 17.85 | 18.61 | 18.02 | 19.07 | ×1.51 | ×0.95 |
| work ms (CDP TaskDuration) | 365.56 | 240.03 | 238.02 | 245.29 | 240.2 | 251.14 | ×1.52 | ×0.96 |
| layout ms | 62.91 | 65.99 | 58.64 | 66.51 | 60.19 | 64.01 | ×1.05 | ×1.03 |
| paint ms | 283.67 | 155.78 | 161.51 | 160.72 | 163.76 | 170.01 | ×1.73 | ×0.92 |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

**gpu raster — `mainStream`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % per 1k chars (normalized) | 11.43 | 8.56 | 7.79 | 8.34 | 7.54 | 8.21 | ×1.52 | ×1.04 |
| busy % (renderer main thread) | 32.92 | 24.65 | 22.44 | 24.04 | 21.69 | 23.64 | ×1.52 | ×1.04 |
| work ms per 1k chars | 237.16 | 176.68 | 160.74 | 172.51 | 155.55 | 169.81 | ×1.52 | ×1.04 |
| p95 frame interval ms | 16.7 | 16.75 | 16.8 | 16.8 | 16.8 | 16.75 | ×0.99 | ×1 |
| frames > 33 ms | 1 | 1 | 1 | 1 | 1 | 1 | — | — |
| sky frames painted in window | 61 | 59 | 61 | 59 | 0 | 0 | — | — |
| chars streamed in 2 s | 2880 | 2880 | 2880 | 2880 | 2880 | 2880 | ×1 | ×1 |
| stream frames in 2 s | 120 | 120 | 120 | 120 | 120 | 120 | ×1 | ×1 |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

**gpu raster — `btwScroll`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 44.53 | 28.52 | 39 | 33.06 | 31.6 | 35.08 | ×1.41 | ×0.81 |
| work ms (CDP TaskDuration) | 921.31 | 586.77 | 865.42 | 687.23 | 649.31 | 720.35 | ×1.42 | ×0.81 |
| paint ms | 916.86 | 582.52 | 603.01 | 681.04 | 647.23 | 717.97 | ×1.42 | ×0.81 |
| p95 frame interval ms | 16.7 | 16.75 | 16.8 | 16.7 | 16.75 | 16.7 | ×1 | ×1 |
| p99 frame interval ms | 16.8 | 16.8 | 33.3 | 16.8 | 16.8 | 16.8 | ×1 | ×1 |
| frames > 25 ms | 0 | 0 | 3.5 | 0 | 0 | 0 | — | — |
| frames > 33 ms | 0 | 0 | 3.5 | 0 | 0 | 0 | — | — |
| frames > 34 ms | 0 | 0 | 0.5 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| achieved px/s | 1485.15 | 1491.82 | 1485.88 | 1491.82 | 1498.13 | 1491.82 | ×0.99 | ×1 |
| nominal px/s | 1500 | 1500 | 1500 | 1500 | 1500 | 1500 | ×1 | ×1 |
| distance travelled px | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| sky frames painted in window | 22.5 | 21 | 18 | 17.5 | 0 | 0 | — | — |
| frames in window | 121 | 120.5 | 117 | 120.5 | 120 | 120.5 | ×1.01 | ×1 |
| mean fps | 60 | 60 | 58.02 | 60 | 60 | 60 | ×1 | ×1 |

**gpu raster — `btwWheel`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 20.74 | 14.53 | 18.01 | 19.3 | 17.57 | 19.91 | ×1.18 | ×0.73 |
| work ms (CDP TaskDuration) | 422.46 | 296.01 | 366.91 | 393.16 | 358.04 | 405.41 | ×1.18 | ×0.73 |
| paint ms | 411.68 | 285.99 | 356.36 | 382.81 | 349.15 | 395.26 | ×1.18 | ×0.72 |
| p95 frame interval ms | 16.75 | 16.7 | 16.75 | 16.75 | 16.7 | 16.75 | ×1 | ×1 |
| p99 frame interval ms | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 | ×1 | ×1 |
| frames > 25 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| frames > 34 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| achieved px/s | 1479.87 | 1479.27 | 1478.51 | 1478.65 | 1478.76 | 1478.4 | ×1 | ×1 |
| nominal px/s | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| distance travelled px | 2977 | 2978 | 2975.5 | 2978 | 2976 | 2977 | ×1 | ×1 |
| sky frames painted in window | 16 | 0.5 | 16 | 0.5 | 0 | 0 | — | — |
| frames in window | 121 | 121 | 121 | 121 | 121 | 121 | ×1 | ×1 |
| mean fps | 60.22 | 60.2 | 60.22 | 60.2 | 60.22 | 60.19 | ×1 | ×1 |
| wheel notches dispatched (trusted) | 40 | 40 | 40 | 40 | 40 | 40 | ×1 | ×1 |
| slow input events, all (≥16 ms) | 20 | 3 | 0 | 0 | 0 | 0 | — | — |
| distance vs programmatic cell | 0.99 | 0.99 | 0.99 | 0.99 | 0.99 | 0.99 | ×1 | ×1 |
| resume frames after the wheel | 8 | 8 | 8 | 8 | 0 | 0 | — | — |

**gpu raster — `btwTyping`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| p50 keystroke ms | 9.25 | 4.05 | 4.85 | 4.3 | 3.9 | 4.25 | ×2.37 | ×0.95 |
| p95 keystroke ms | 16.3 | 14.55 | 17.35 | 17.1 | 15.5 | 17.45 | ×1.05 | ×0.83 |
| max keystroke ms | 16.75 | 17.55 | 17.8 | 17.95 | 16.25 | 18.6 | ×1.03 | ×0.94 |
| slow input events (≥16 ms) | 20.5 | 14.5 | 18 | 16.5 | 11.5 | 14.5 | ×1.78 | ×1 |
| slow share | 0.52 | 0.37 | 0.45 | 0.42 | 0.29 | 0.37 | ×1.79 | ×1 |
| busy % (renderer main thread) | 32.56 | 23.03 | 24.42 | 25.19 | 23.53 | 25.55 | ×1.38 | ×0.9 |
| work ms (CDP TaskDuration) | 435.21 | 304.23 | 325.74 | 332.54 | 309.1 | 337.99 | ×1.41 | ×0.9 |
| layout ms | 63.33 | 65.6 | 66.75 | 71.08 | 60.72 | 66.94 | ×1.04 | ×0.98 |
| paint ms | 356.07 | 221.38 | 242.75 | 247.39 | 234.7 | 255.87 | ×1.52 | ×0.87 |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

### software raster

**software raster — `mainScroll`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 57.74 | 49.68 | 50.11 | 50.09 | 20.9 | 21.32 | ×2.76 | ×2.33 |
| work ms (CDP TaskDuration) | 1200.86 | 1030.48 | 1029.64 | 1035.42 | 431.17 | 439.89 | ×2.79 | ×2.34 |
| paint ms | 1197.54 | 1026.44 | 1026.05 | 1031.59 | 428.6 | 437.22 | ×2.79 | ×2.35 |
| p95 frame interval ms | 50 | 33.4 | 33.4 | 33.35 | 16.75 | 16.7 | ×2.99 | ×2 |
| p99 frame interval ms | 66.7 | 33.4 | 33.4 | 33.4 | 16.8 | 16.8 | ×3.97 | ×1.99 |
| frames > 25 ms | 27.5 | 17 | 16 | 16.5 | 0 | 0 | — | — |
| frames > 33 ms | 27.5 | 17 | 16 | 16.5 | 0 | 0 | — | — |
| frames > 34 ms | 13.5 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 1.5 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 76.5 | 0 | 0 | 0 | 0 | 0 | — | — |
| achieved px/s | 2967.37 | 2984.38 | 2973.24 | 2973.24 | 2973.24 | 2973.24 | ×1 | ×1 |
| nominal px/s | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| distance travelled px | 6000 | 6000 | 6000 | 6000 | 6000 | 6000 | ×1 | ×1 |
| sky frames painted in window | 16 | 16 | 16 | 16 | 0 | 0 | — | — |
| frames in window | 79 | 103.5 | 105 | 105 | 121 | 121 | ×0.65 | ×0.86 |
| mean fps | 39.34 | 51.54 | 52.04 | 51.86 | 60 | 60 | ×0.66 | ×0.86 |

**software raster — `mainWheel`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 52.31 | 16.82 | 46.62 | 17.02 | 14.78 | 15.58 | ×3.54 | ×1.08 |
| work ms (CDP TaskDuration) | 1084.36 | 342.66 | 954.83 | 346.99 | 298.56 | 314.59 | ×3.63 | ×1.09 |
| paint ms | 1070.61 | 325.94 | 940.32 | 330.92 | 285.52 | 300.08 | ×3.75 | ×1.09 |
| p95 frame interval ms | 50 | 16.7 | 33.4 | 16.8 | 16.7 | 16.75 | ×2.99 | ×1 |
| p99 frame interval ms | 66.65 | 16.8 | 33.4 | 16.8 | 16.8 | 16.8 | ×3.97 | ×1 |
| frames > 25 ms | 18.5 | 1 | 17 | 1 | 0 | 0 | — | — |
| frames > 33 ms | 18.5 | 1 | 17 | 1 | 0 | 0 | — | — |
| frames > 34 ms | 14 | 0 | 0.5 | 0 | 0 | 0 | — | — |
| long tasks (count) | 1.5 | 0 | 1 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 76.5 | 0 | 50.5 | 0 | 0 | 0 | — | — |
| achieved px/s | 2825.26 | 2961.19 | 2875.38 | 2949.25 | 2935.84 | 2935.84 | ×0.96 | ×1.01 |
| nominal px/s | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| distance travelled px | 5779.5 | 5950.5 | 5779.5 | 5928 | 5901 | 5902.5 | ×0.98 | ×1.01 |
| sky frames painted in window | 16 | 1 | 16 | 1 | 0 | 0 | — | — |
| frames in window | 89.5 | 121 | 103.5 | 121 | 122 | 122 | ×0.73 | ×0.99 |
| mean fps | 43.85 | 60.26 | 51.65 | 60.25 | 60.72 | 60.69 | ×0.72 | ×0.99 |
| wheel notches dispatched (trusted) | 28.5 | 39 | 31 | 39 | 39 | 39 | ×0.73 | ×1 |
| slow input events, all (≥16 ms) | 321.5 | 67 | 191 | 49 | 78.5 | 74 | ×4.1 | ×0.91 |
| distance vs programmatic cell | 0.96 | 0.99 | 0.97 | 0.99 | 0.98 | 0.98 | ×0.98 | ×1.01 |
| resume frames after the wheel | 8 | 8 | 8 | 8 | 0 | 0 | — | — |

**software raster — `mainTyping`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| p50 keystroke ms | 5.2 | 2.95 | 2.8 | 2.9 | 2.85 | 2.85 | ×1.82 | ×1.04 |
| p95 keystroke ms | 19.75 | 15.35 | 9.6 | 16.15 | 16.5 | 15.4 | ×1.2 | ×1 |
| max keystroke ms | 20.55 | 16.6 | 11.8 | 17.2 | 17.1 | 16.5 | ×1.2 | ×1.01 |
| slow input events (≥16 ms) | 40 | 15.5 | 12 | 12.5 | 14.5 | 11 | ×2.76 | ×1.41 |
| slow share | 1 | 0.39 | 0.3 | 0.32 | 0.37 | 0.28 | ×2.7 | ×1.39 |
| busy % (renderer main thread) | 53.99 | 18.12 | 48.35 | 18.81 | 19.24 | 19.65 | ×2.81 | ×0.92 |
| work ms (CDP TaskDuration) | 970.48 | 238.67 | 833.95 | 251.62 | 253.97 | 259.73 | ×3.82 | ×0.92 |
| layout ms | 65.48 | 64 | 66.78 | 67.94 | 63.55 | 65.6 | ×1.03 | ×0.98 |
| paint ms | 884.69 | 157.05 | 747.42 | 165.36 | 172.73 | 176.24 | ×5.12 | ×0.89 |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 0 | 0 | 0 | 0 | 0 | 0 | — | — |

**software raster — `mainStream`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % per 1k chars (normalized) | 64.44 | 53.53 | 60.91 | 55.38 | 8.18 | 8.3 | ×7.88 | ×6.45 |
| busy % (renderer main thread) | 85.81 | 89.13 | 94.91 | 93.03 | 23.58 | 23.9 | ×3.64 | ×3.73 |
| work ms per 1k chars | 1391.64 | 1143.19 | 1314.87 | 1187.27 | 169.3 | 171.45 | ×8.22 | ×6.67 |
| p95 frame interval ms | 50.1 | 50 | 50 | 50 | 16.8 | 16.7 | ×2.98 | ×2.99 |
| frames > 33 ms | 34.5 | 44.5 | 42 | 41 | 1 | 1 | — | — |
| sky frames painted in window | 35 | 38.5 | 42 | 40 | 0 | 0 | — | — |
| chars streamed in 2 s | 1332 | 1656 | 1548 | 1680 | 2880 | 2880 | ×0.46 | ×0.57 |
| stream frames in 2 s | 55.5 | 69 | 64.5 | 70 | 120 | 120 | ×0.46 | ×0.57 |
| long tasks (count) | 7 | 1 | 2 | 0.5 | 0 | 0 | — | — |

**software raster — `btwScroll`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 77.79 | 57.77 | 60.68 | 61.2 | 32.36 | 34.39 | ×2.4 | ×1.68 |
| work ms (CDP TaskDuration) | 1998.34 | 1205.2 | 1268.01 | 1286.1 | 664.34 | 711.11 | ×3.01 | ×1.69 |
| paint ms | 1531.51 | 1201.86 | 1264.26 | 1281 | 662.15 | 708.89 | ×2.31 | ×1.7 |
| p95 frame interval ms | 33.4 | 33.4 | 33.35 | 33.4 | 16.75 | 16.75 | ×1.99 | ×1.99 |
| p99 frame interval ms | 50 | 41.75 | 33.4 | 33.4 | 16.8 | 16.8 | ×2.98 | ×2.49 |
| frames > 25 ms | 27 | 21 | 18 | 17 | 0 | 0 | — | — |
| frames > 33 ms | 27 | 21 | 18 | 17 | 0 | 0 | — | — |
| frames > 34 ms | 3.5 | 0.5 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 4 | 1 | 0.5 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 205.5 | 52 | 25 | 0 | 0 | 0 | — | — |
| achieved px/s | 1479.32 | 1485.52 | 1491.82 | 1485.88 | 1491.82 | 1485.52 | ×0.99 | ×1 |
| nominal px/s | 1500 | 1500 | 1500 | 1500 | 1500 | 1500 | ×1 | ×1 |
| distance travelled px | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| sky frames painted in window | 16.5 | 17 | 16.5 | 16.5 | 0 | 0 | — | — |
| frames in window | 90 | 99 | 102.5 | 103 | 120.5 | 121 | ×0.75 | ×0.82 |
| mean fps | 44.64 | 49.3 | 51.04 | 51.29 | 60 | 60 | ×0.74 | ×0.82 |

**software raster — `btwWheel`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busy % (renderer main thread) | 49.97 | 16.41 | 48.32 | 19.89 | 17.84 | 18.85 | ×2.8 | ×0.87 |
| work ms (CDP TaskDuration) | 1030.24 | 334.22 | 987.07 | 400.95 | 363.53 | 383.98 | ×2.83 | ×0.87 |
| paint ms | 1020.52 | 324.57 | 977.12 | 391.22 | 354.42 | 374.32 | ×2.88 | ×0.87 |
| p95 frame interval ms | 49.9 | 16.8 | 33.4 | 16.75 | 16.75 | 16.7 | ×2.98 | ×1.01 |
| p99 frame interval ms | 50.1 | 16.8 | 33.4 | 16.8 | 16.8 | 16.8 | ×2.98 | ×1 |
| frames > 25 ms | 17.5 | 1 | 16.5 | 1 | 0 | 0 | — | — |
| frames > 33 ms | 17.5 | 1 | 16.5 | 1 | 0 | 0 | — | — |
| frames > 34 ms | 5 | 0 | 0.5 | 0 | 0 | 0 | — | — |
| long tasks (count) | 2 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (total ms) | 101 | 0 | 0 | 0 | 0 | 0 | — | — |
| achieved px/s | 1441.59 | 1479.26 | 1441.72 | 1469.39 | 1478.89 | 1478.89 | ×0.97 | ×1 |
| nominal px/s | 3000 | 3000 | 3000 | 3000 | 3000 | 3000 | ×1 | ×1 |
| distance travelled px | 2912 | 2977 | 2900 | 2952 | 2976 | 2977 | ×0.98 | ×1 |
| sky frames painted in window | 16 | 1 | 16 | 1 | 0 | 0 | — | — |
| frames in window | 99.5 | 120 | 103.5 | 120 | 121 | 121 | ×0.82 | ×0.99 |
| mean fps | 49.47 | 59.71 | 51.45 | 59.72 | 60.22 | 60.21 | ×0.82 | ×0.99 |
| wheel notches dispatched (trusted) | 31 | 39 | 31 | 39 | 40 | 40 | ×0.78 | ×0.97 |
| slow input events, all (≥16 ms) | 97.5 | 0 | 90.5 | 6.5 | 0 | 0 | — | — |
| distance vs programmatic cell | 0.97 | 0.99 | 0.97 | 0.99 | 0.99 | 0.99 | ×0.98 | ×1 |
| resume frames after the wheel | 8 | 8 | 8 | 8 | 0 | 0 | — | — |

**software raster — `btwTyping`**

| metric | B·on | A·on | B·css-off | A·css-off | B·off | A·off | B on/off | A on/off |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| p50 keystroke ms | 4.75 | 4.1 | 4.1 | 4.1 | 4 | 4 | ×1.19 | ×1.02 |
| p95 keystroke ms | 19.75 | 14.95 | 14.7 | 13.15 | 16.65 | 16.6 | ×1.19 | ×0.9 |
| max keystroke ms | 22 | 15.2 | 18.45 | 13.95 | 18.2 | 17.6 | ×1.21 | ×0.86 |
| slow input events (≥16 ms) | 29.5 | 16 | 12 | 11.5 | 17 | 16 | ×1.74 | ×1 |
| slow share | 0.74 | 0.41 | 0.31 | 0.29 | 0.43 | 0.4 | ×1.72 | ×1.02 |
| busy % (renderer main thread) | 57.61 | 22.82 | 52.87 | 26.35 | 24.2 | 24.89 | ×2.38 | ×0.92 |
| work ms (CDP TaskDuration) | 1026.16 | 306.01 | 924.93 | 350.66 | 318.38 | 329.25 | ×3.22 | ×0.93 |
| layout ms | 67.05 | 69.24 | 69.43 | 66.93 | 62.85 | 65.44 | ×1.07 | ×1.06 |
| paint ms | 943.47 | 220.98 | 839.09 | 267.97 | 241.07 | 247.52 | ×3.91 | ×0.89 |
| frames > 33 ms | 0 | 0 | 0 | 0 | 0 | 0 | — | — |
| long tasks (count) | 1.5 | 0 | 0 | 0 | 0 | 0 | — | — |

### 3.4 What changed between round 6 and round 7 on the *same* after side

Round 6's after side was measured on `43c627558ce2…` (11 files); this one on `a3312e9248c3…` (12 files).
Both used the same harness and the same commit, and the before side is byte-identical, so the only intended variable is the
tree change — the mentions dedup (`sameRead`/`reread()`) and the `promptFit` move in `src/main.ts`, plus comment/doc/test
edits. But the machine is not a variable that can be held still, so the table below carries the **control** as well: if the
sky-off cell moved by as much as the sky-on cell, the movement is the box, not the tree.

**gpu raster — after side, round 6 → round 7 (busy %)**

| cell | kind | on r6 → r7 (Δ) | off r6 → r7 (Δ) | on−off r6 → r7 (Δ) |
|---|---|---:|---:|---:|
| `mainScroll` | synthetic | 16.94 → **17.99** (+1.05) | 19.62 → 20.9 (+1.28) | -2.68 → **-2.91** (-0.23) |
| `mainWheel` | reader | 13.34 → **14.08** (+0.74) | 14.12 → 15.16 (+1.04) | -0.78 → **-1.08** (-0.3) |
| `mainTyping` | reader | 17 → **18.19** (+1.19) | 18.2 → 19.07 (+0.87) | -1.2 → **-0.88** (+0.32) |
| `mainStream` | app | 21.9 → **24.65** (+2.75) | 21.65 → 23.64 (+1.99) | 0.25 → **1.01** (+0.76) |
| `btwScroll` | synthetic | 26.78 → **28.52** (+1.74) | 31.13 → 35.08 (+3.95) | -4.35 → **-6.56** (-2.21) |
| `btwWheel` | reader | 13.44 → **14.53** (+1.09) | 17.67 → 19.91 (+2.24) | -4.23 → **-5.38** (-1.15) |
| `btwTyping` | reader | 20.99 → **23.03** (+2.04) | 23.29 → 25.55 (+2.26) | -2.3 → **-2.52** (-0.22) |

**software raster — after side, round 6 → round 7 (busy %)**

| cell | kind | on r6 → r7 (Δ) | off r6 → r7 (Δ) | on−off r6 → r7 (Δ) |
|---|---|---:|---:|---:|
| `mainScroll` | synthetic | 49.78 → **49.68** (-0.1) | 20.92 → 21.32 (+0.4) | 28.86 → **28.36** (-0.5) |
| `mainWheel` | reader | 15.87 → **16.82** (+0.95) | 14.71 → 15.58 (+0.87) | 1.16 → **1.24** (+0.08) |
| `mainTyping` | reader | 17.63 → **18.12** (+0.49) | 19.18 → 19.65 (+0.47) | -1.55 → **-1.53** (+0.02) |
| `mainStream` | app | 90.76 → **89.13** (-1.63) | 23.74 → 23.9 (+0.16) | 67.02 → **65.23** (-1.79) |
| `btwScroll` | synthetic | 57.41 → **57.77** (+0.36) | 31.21 → 34.39 (+3.18) | 26.2 → **23.38** (-2.82) |
| `btwWheel` | reader | 15.67 → **16.41** (+0.74) | 18.01 → 18.85 (+0.84) | -2.34 → **-2.44** (-0.1) |
| `btwTyping` | reader | 22.42 → **22.82** (+0.4) | 24.17 → 24.89 (+0.72) | -1.75 → **-2.07** (-0.32) |

**The on-side rise is the box, not the tree.** Across the 14 cell-raster pairs the sky-on busy % rose by
-1.63 to 2.75 points (median 0.85) — but the sky-off control rose by
0.16 to 3.95 (median 0.96), and the after run began at a 5-minute load of 5.91
against round 6's 1.91 (15-minute 8.55 vs 5.12). Subtracting each run's own control, the tree
change is -2.82 to 0.76 busy points (median -0.27): no cell moved beyond that, and the one
large number (`btwScroll`, software, -2.82) is a shift in the *control*'s
side-thread synthetic scroll (31.21 → 34.39 with the sky off), not in the sky-on cell
(57.41 → 57.77).

**Typing specifically.** The intended effect of the mentions dedup is fewer per-keystroke scans, i.e. less main-thread work
and fewer slow events. Measured, on the same after side, round 6 → round 7:

| raster | cell | p50 keystroke ms | p95 keystroke ms | slow input events (of 40) | busy % | busy on−off | paint ms |
|---|---|---:|---:|---:|---:|---:|---:|
| gpu | `mainTyping` | 2.7 → **2.9** (+0.2) | 10.25 → **16.15** (+5.9) | 7.5 → **15.5** (+8) | 17 → **18.19** (+1.19) | -1.2 → **-0.88** (+0.32) | 149.15 → **155.78** (+6.63) |
| gpu | `btwTyping` | 6 → **4.05** (-1.95) | 14.6 → **14.55** (-0.05) | 20 → **14.5** (-5.5) | 20.99 → **23.03** (+2.04) | -2.3 → **-2.52** (-0.22) | 205.44 → **221.38** (+15.94) |
| software | `mainTyping` | 7.4 → **2.95** (-4.45) | 14.65 → **15.35** (+0.7) | 19 → **15.5** (-3.5) | 17.63 → **18.12** (+0.49) | -1.55 → **-1.53** (+0.02) | 153.78 → **157.05** (+3.27) |
| software | `btwTyping` | 4.15 → **4.1** (-0.05) | 14.8 → **14.95** (+0.15) | 19 → **16** (-3) | 22.42 → **22.82** (+0.4) | -1.75 → **-2.07** (-0.32) | 217.38 → **220.98** (+3.6) |

The honest reading: **no typing-specific change is resolvable above the box's own drift.** The GPU slow-event median rose
7.5 → 15.5 of 40, but the sky-off control's own repeats show the same
bimodality (11 / 12 / 18 / 19 before, 0 / 9 / 9 / 15 after) and the on-side repeats lost their two near-zero
members (0 / 0 / 15 / 17 → 13 / 15 / 16 / 16) — a distribution of two populations, not a regression of one. The
software p50 drop (7.4 → 2.95 ms; repeats 2.8 / 2.9 / 11.9 / 13.6 → 2.8 / 2.9 / 3 / 3) is not corroborated by the
software p95 (14.65 → 15.35) or the software slow-event count (19 → 15.5), and the
control-corrected busy is flat (-1.55 → -1.53). So this round does **not** claim
the dedup made typing measurably faster on this box; it claims the tree that carries it still measures at control, and §5.2's
verdict stands on the before→after pair, not on this delta.

## 4. CSS vs hold: what the three states isolate, and what the fix did inside each

`css-off` removes **only the scene's CSS**. The canvas keeps painting and the reader hold keeps running, because the hold
is armed from the wheel / pointer / key listeners in `src/sky-window.ts`, not from `data-scene`. The JSON shows it on both
sides: `resumeFrames` is 8 in `on` and 8 in `css-off`, 0 in `off` (both rasters, both runs, and
the same for `btwWheel`), and the after-fix `css-off` state paints 1 sky frame in
`mainWheel` (sorted repeats 0 / 1 / 1 / 1) and 0.5 in `btwWheel`, against 16 on the before side.
So `on − css-off` is **not** the hold: it is the scene CSS, measured with the hold in whatever state that run had it
(ineffective before the fix — full-rate sky frames in both states; effective after — ~1 frame in both). Three differences
are worth naming, and nothing else in this section is:

| difference | what it measures |
|---|---|
| `on − css-off`, within one run | the scene CSS, with the hold as that run had it |
| `css-off − off`, within one run | the canvas painting, with the hold as that run had it |
| before → after **inside one state** | what the fix did in that state; `css-off` has no scene CSS, so that column is the hold alone |

| cell | raster | B·on | B·css-off | B·off | CSS (B) | canvas (B) | A·on | A·css-off | A·off | CSS (A) | canvas (A) | fix in `on` | fix in `css-off` |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `mainWheel` | gpu | 22.12 | 14.22 | 14.16 | 7.9 | 0.06 | 14.08 | 15.16 | 15.16 | -1.08 | 0 | -8.04 | 0.94 |
| `btwWheel` | gpu | 20.74 | 18.01 | 17.57 | 2.73 | 0.44 | 14.53 | 19.3 | 19.91 | -4.77 | -0.61 | -6.21 | 1.29 |
| `mainWheel` | software | 52.31 | 46.62 | 14.78 | 5.69 | 31.84 | 16.82 | 17.02 | 15.58 | -0.2 | 1.44 | -35.49 | -29.6 |
| `btwWheel` | software | 49.97 | 48.32 | 17.84 | 1.65 | 30.48 | 16.41 | 19.89 | 18.85 | -3.48 | 1.04 | -33.56 | -28.43 |

Sky frames inside the window (the hold's fingerprint), the same four cells, `css-off` side: 16 → 1 (`mainWheel`, gpu),
16 → 1 (`mainWheel`, software), 16 → 0.5 (`btwWheel`, gpu), 16 → 1 (`btwWheel`, software);
`on` goes 16 → 0 (gpu) and 16 → 1 (software) on the main wheel.

The wheel cells, decomposed (the owner's real gesture):

- **GPU, `mainWheel`.** Before: 22.12 busy on, 14.22 with the scene CSS removed, 14.16 with no canvas — CSS term 7.9, canvas term 0.06; the gesture cost **7.96** points over its no-sky control (×1.56). After: 14.08 on, 15.16 css-off, 15.16 off — CSS term -1.08, canvas term 0 (repeat ranges: `on` 13.72–14.77, `css-off` 14.7–16.48, `off` 14.91–16), and `on` sits 1.08 points *below* the control (×0.93). The fix's own contribution is **-8.04 in `on`** and **0.94 in `css-off`**. With the CSS already removed the hold is worth only 0.94 points — an increase, not a saving — so the win is the interaction: it stops the frames the CSS made expensive (sky frames 16 → 0), and the CSS term moved from 7.9 to -1.08 while the canvas term moved from 0.06 to 0.
- **GPU, `btwWheel`.** Before: 20.74 busy on, 18.01 with the scene CSS removed, 17.57 with no canvas — CSS term 2.73, canvas term 0.44; the gesture cost **3.17** points over its no-sky control (×1.18). After: 14.53 on, 19.3 css-off, 19.91 off — CSS term -4.77, canvas term -0.61 (repeat ranges: `on` 13.43–16.81, `css-off` 18.65–20.59, `off` 19.49–20.6), and `on` sits 5.38 points *below* the control (×0.73). The fix's own contribution is **-6.21 in `on`** and **1.29 in `css-off`**. With the CSS already removed the hold is worth only 1.29 points — an increase, not a saving — so the win is the interaction: it stops the frames the CSS made expensive (sky frames 16 → 0.5), and the CSS term moved from 2.73 to -4.77 while the canvas term moved from 0.44 to -0.61. The after-side CSS term of -4.77 is negative and repeat-consistent (`on` 13.43–16.81 vs `css-off` 18.65–20.59) although both states paint about 0.5 sky frames; removing CSS cannot *add* 4.77 points of main-thread work, so that is an unmodelled state difference — reported as measured, not used as a size anywhere.
- **Software, `mainWheel`.** Before: 52.31 busy on, 46.62 with the scene CSS removed, 14.78 with no canvas — CSS term 5.69, canvas term 31.84; the gesture cost **37.53** points over its no-sky control (×3.54). After: 16.82 on, 17.02 css-off, 15.58 off — CSS term -0.2, canvas term 1.44 (repeat ranges: `on` 16.49–18.3, `css-off` 16.55–17.35, `off` 14.69–16.95), and `on` sits 1.24 points above the control (×1.08). The fix's own contribution is **-35.49 in `on`** and **-29.6 in `css-off`**. With the CSS already removed the hold still carries 29.6 of it, so on this raster the hold does the work directly: the canvas term fell from 31.84 to 1.44 and the CSS was never the cost (5.69 before).
- **Software, `btwWheel`.** Before: 49.97 busy on, 48.32 with the scene CSS removed, 17.84 with no canvas — CSS term 1.65, canvas term 30.48; the gesture cost **32.13** points over its no-sky control (×2.8). After: 16.41 on, 19.89 css-off, 18.85 off — CSS term -3.48, canvas term 1.04 (repeat ranges: `on` 15.81–18.56, `css-off` 19.06–20.62, `off` 18.05–19.9), and `on` sits 2.44 points *below* the control (×0.87). The fix's own contribution is **-33.56 in `on`** and **-28.43 in `css-off`**. With the CSS already removed the hold still carries 28.43 of it, so on this raster the hold does the work directly: the canvas term fell from 30.48 to 1.04 and the CSS was never the cost (1.65 before). The after-side CSS term of -3.48 is negative and repeat-consistent (`on` 15.81–18.56 vs `css-off` 19.06–20.62) although both states paint about 1 sky frame; removing CSS cannot *add* 3.48 points of main-thread work, so that is an unmodelled state difference — reported as measured, not used as a size anywhere.

## 5. Verdict per complaint, each cell against its own control

The owner's report has three complaints, plus one claim about the side panel that this round checks. Each is judged on
the cell that carries the same input, against that cell's own no-sky control **and** against what the same fix did to the
reader cell (the synthetic cells do not arm the hold and are not the owner's gesture). `B`/`A` and the ratios are the
medians from §3.

### 5.1 "Scrolling a long transcript feels laggy" — **fixed on both rasters for the owner's wheel; the app-driven scroll no longer costs anything measurable on the GPU and still costs 2.33× its control on software**

- **GPU wheel (`mainWheel`, real trusted wheel events):** busy 22.12 → **14.08** against a control of 15.16 (×0.93; before ×1.56); p95 16.7 → 16.75 ms, 0 frames > 33 ms, 0 long tasks; 5901 px delivered at 2935.82 px/s (×0.98 of the programmatic cell's 6000 px), sky frames 16 → 0.
- **Software wheel:** busy 52.31 → **16.82** against 15.58 (×1.08; before ×3.54); p95 50 → 16.7 ms, frames > 33 ms 18.5 → 1, long tasks 1.5 → 0; 5950.5 px at 2961.19 px/s (before 5779.5 px at 2825.26: the stalled window dispatched fewer notches (28.5 vs 39) and delivered 171 px more after — see §7).
- **Synthetic (`mainScroll`, no input event, so no hold by design):** GPU 34.63 → **17.99**, which is *below* its own no-sky control of 20.9 (×0.86; before ×1.77). That ratio is not the evidence (§4: the control is not a floor); the evidence is the before-fix `css-off` column — 17.72 with the CSS removed against 34.63 with it, a CSS term of 16.91 that is -2.1 after. At control. Software 57.74 → 49.68 against 21.32 (×2.33; before ×2.76): improved, but still 28.36 busy points over control (residual R1, §6). The wheel cell is what the owner feels; the synthetic cell is the floor the fix cannot reach without arming on programmatic scroll, which it deliberately does not.

### 5.2 "Typing in the composer feels laggy" — **fixed on both rasters in main-thread work; the keystroke-latency win is demonstrated on the software raster**

- **GPU main composer:** the metric that moved is main-thread busy, 27.16 → **18.19** against 18.02 → 19.07 (×1.51 before, ×0.95 after); work 365.56 → 240.03 ms, paint 283.67 → 155.78 ms, and the p50 keystroke is 2.9 vs 2.8 ms. The tail did **not** shrink on this raster: p95 16.15 vs 16.25 before (×0.99) and 16.15 vs 14.6 after (×1.11); slow events 20.5 vs 19.5 before (×1.05) and 15.5 vs 9 after (×1.72). This round the after-side GPU repeats are 13 / 15 / 16 / 16 slow events and 15.1 / 16.1 / 16.2 / 16.2 ms p95 — no near-zero repeat, unlike round 6's 0 / 0 / 15 / 17 — while the control's repeats are 0 / 9 / 9 / 15 (one clean repeat sets its median) and `css-off` is higher than both (18.5). Read the GPU typing verdict as "main-thread work is back at control, the keystroke tail is not"; the latency win is demonstrated on the software raster.
- **Software main composer:** p95 19.75 → **15.35** ms against 15.4 (×1; before ×1.2, a real pre-fix sky cost: 19.75 vs 16.5), max 20.55 → 16.6 ms; slow events 40 → **15.5** of 40 against 11 (before ×2.76, after ×1.41); busy 53.99 → 18.12 against 19.65; paint 884.69 → 157.05 ms. The p50 fell (5.2 → 2.95 ms against a control of 2.85 → 2.85) — at or below control.
- **Side composer:** p95 16.3 → **14.55** ms (GPU) against 17.45; software 19.75 → **14.95** against 16.6. The slow-event count came back on the GPU (20.5 → 14.5 against 14.5) — at control.

### 5.3 "Streaming a reply feels heavy" — **fixed on the GPU; still 6.45× its control on software**

- GPU, normalized so the run's own wind cannot flatter it: busy % per 1k chars 11.43 → **8.56** against 8.21 (×1.04; before ×1.52); busy 32.92 → 24.65 against 23.64; frames > 33 ms 1 → 1.
- Software: normalized 64.44 → 53.53 against 8.3 — **×6.45** (before ×7.88), i.e. a real improvement and a real residual (R2, §6). The absolute busy % looks worse (85.81 → 89.13) because the two runs streamed different amounts in their 2 s window (1332 vs 1656 chars) — §7.

### 5.4 "The BTW side panel is smooth" — **true after the fix on both rasters; before, the side wheel was not free**

- **GPU side wheel (`btwWheel`, real trusted wheel events over `.btw-transcript`):** busy 20.74 → **14.53** against 19.91 (×0.73; before ×1.18); p95 16.75 → 16.7 ms; sky frames 16 → 0.5; slow side-wheel-window input events 20 → 3 against 0.
- **Software side wheel:** busy 49.97 → **16.41** against 18.85 (×0.87; before ×2.8); p95 49.9 → 16.8 ms, frames > 33 ms 17.5 → 1; 2977 px at 1479.26 px/s (before 2912 px at 1441.59, 31 of 40 notches dispatched inside its stalled window, 39 after).
- **Synthetic side scroll (`btwScroll`, no hold by design):** GPU 44.53 → 28.52, 6.56 points *below* its own control of 35.08 (×0.81; before ×1.41) — at control within the floor problem of §4, not a proven CSS win; the before-fix `css-off` column is 39. Software 77.79 → 57.77 against 34.39 (×1.68; before ×2.4): improved 20.02 points, still 23.38 over control (R3, §6).

The owner's sentence — "the BTW side panel is smooth" — is **true** of the shipped tree on both rasters: the side wheel now sits at ×0.73 / ×0.87 of a no-canvas control, both *below* it, which §4 reads as "at control" rather than as a measured speedup. It was **not** true before the fix on software (×2.8 of control), which is why the side thread is measured separately instead of being assumed free.

## 6. Residual: what is *not* fixed, with sizes

Sizes are the cell's own after-side median against its own no-sky control (busy points, or the sharper number where
there is one). Every row is a cell the fix did not arm on, an input surface whose cost is not the sky, or a millisecond-scale
tail; nothing here is inferred from round 6.

| # | residual | raster | cell (kind) | after (on) | control | size | before (on) | what it is |
|---|---|---|---|---:|---:|---:|---:|---|
| R1 | app-driven transcript scroll still costs a multiple of a no-sky control | software | `mainScroll` (synthetic) | 49.68 | 21.32 | **+28.36 pts, ×2.33; p95 33.4 vs 16.7 ms; 17 vs 0 frames > 33 ms** | 57.74 (×2.76) | a position write arms no hold, so the canvas keeps painting; `css-off` ≈ `on` says it is canvas, not CSS |
| R2 | streaming still costs a multiple of a no-sky control (normalized) | software | `mainStream` (app) | 53.53 | 8.3 | **+45.23 pts/1k, ×6.45** | 64.44 (×7.88) | the app pins `scrollTop` per streamed frame — no reader event, no hold; the sky keeps painting |
| R3 | side synthetic scroll still costs a multiple of a no-sky control | software | `btwScroll` (synthetic) | 57.77 | 34.39 | **+23.38 pts, ×1.68; p95 33.4 vs 16.75 ms; 21 vs 0 frames > 33 ms** | 77.79 (×2.4) | same mechanism as R1, on the side thread's own sky canvases |
| R4 | software wheel residue: the only after-fix wheel cell above its control | software | `mainWheel` (reader) | 16.82 | 15.58 | **+1.24 pts, ×1.08** | 52.31 (×3.54) | small and consistent across repeats; sky frames 1, so it is not the canvas painting at full rate |
| R5 | main composer slow key events stop a little above control on software | software | `mainTyping` (reader) | 15.5 | 11 | **15.5 vs 11 slow events of 40** | 40 (×2.76) | improved from ×2.76 before, but a few events of 40 remain over control; p95 is at control |
| R6 | GPU main composer keystroke tail sits above a control median taken from one clean repeat | gpu | `mainTyping` (reader) | 15.5 | 9 | **15.5 vs 9 slow events of 40; p95 16.15 vs 14.6 ms** | 20.5 (×1.05) | on repeats 15.1 / 16.1 / 16.2 / 16.2 ms against a control of 14 / 15.6 / 15.2 / 3.3; +1.55 ms, at the 16 ms Event Timing floor |

R1–R3 share one cause: **the hold is armed by reader input, not by a position write**, so an app-driven scroll (or a
streamed pin) still pays for the sky's frames. That is a design boundary, not an unfinished patch: arming on a
programmatic scroll would keep the canvas painting during the app's own streaming, which is the case where the owner
wants the sky to keep its wind. Their GPU side is at control (×0.86, ×0.81, ×1.04), which per §4 is not by itself a win; what the GPU
side does show is the CSS term falling, visible in the before-fix `css-off` column of each one:
17.72 vs 34.63 (`mainScroll`), 39 vs 44.53 (`btwScroll`), 7.79 vs 11.43 per 1k chars (stream).

## 7. Every metric that moved the wrong way, and what it is

"Wrong way" means: on the fixed tree, the sky-on cell is worse than its own no-sky control (ratio ≥ 1.05 on the same
metric, or a count above a zero control), or worse than the same cell on the pre-fix tree beyond the repeat spread. Three
classifications: **noise** (inside the repeat spread / below the measurement floor), **workload** (the two runs did
different amounts of work, so the absolute number is not comparable — the normalized metric is), **real** (a residual with
a size, listed in §6). Scanned on every cell of both rasters, on busy %, busy %/1k chars (`mainStream`), p95 frame
interval, frames > 33 ms, slow input events, and keystroke p50 / p95 / max — 56 cell-metric pairs. Every pair whose
after-side ratio reaches 1.05, or whose count sits above a zero control, is below; nothing is left out.

| raster | cell | metric | B·on | A·on | A·off | A vs control | class | why |
|---|---|---|---:|---:|---:|---:|---|---|
| gpu | `mainWheel` | slowEventsAll | 77 | 80.5 | 73 | ×1.1 | **noise** | inside the repeat spread on both sides; these are pointer/hover events of any type, never wheel latency |
| gpu | `mainTyping` | p95 key | 16.15 | 16.15 | 14.6 | ×1.11 | **real** (R6) | on repeats 15.1 / 16.1 / 16.2 / 16.2 ms against a control of 14 / 15.6 / 15.2 / 3.3; +1.55 ms, at the 16 ms Event Timing floor |
| gpu | `mainTyping` | max key | 17.8 | 17 | 16.15 | ×1.05 | **noise** | 17 vs 16.15 ms, a single keystroke at the 16 ms Event Timing floor; the same tail as R6, which the p95 and slow-event rows size |
| gpu | `mainTyping` | slowEvents | 20.5 | 15.5 | 9 | ×1.72 | **real** (R6) | 13–16 of 40 in every after repeat; the control median 9 comes from 9 / 15 / 9 / 0, and `css-off` is higher still (18.5), so the ordering is not monotone in the sky. §3.4 shows the round-6→7 move of this cell is the box |
| gpu | `btwWheel` | slowEventsAll | 20 | 3 | 0 | 3 vs 0 | **noise** | 3 events of any input type in the window against 0, from a before side that had 20; hover/pointer churn under a parked cursor, not wheel latency |
| software | `mainScroll` | busy % | 57.74 | 49.68 | 21.32 | ×2.33 | **real** (R1) | a position write arms no hold, so the canvas keeps painting; `css-off` ≈ `on` says it is canvas, not CSS |
| software | `mainScroll` | p95 frame | 50 | 33.4 | 16.7 | ×2 | **real** (R1) | same cell, same mechanism: every second frame over 33 ms while the sky paints |
| software | `mainScroll` | over33 | 27.5 | 17 | 0 | 17 vs 0 | **real** (R1) | same cell: frames over two vsyncs, against zero with the sky off |
| software | `mainWheel` | busy % | 52.31 | 16.82 | 15.58 | ×1.08 | **real** (R4) | small and consistent across repeats; sky frames 1, so it is not the canvas painting at full rate |
| software | `mainWheel` | over33 | 18.5 | 1 | 0 | 1 vs 0 | **noise** | a single 33.x ms frame out of ~122 in the window, and one in `css-off` too |
| software | `mainTyping` | slowEvents | 40 | 15.5 | 11 | ×1.41 | **real** (R5) | improved from ×2.76 before, but a few events of 40 remain over control; p95 is at control |
| software | `mainStream` | busy % | 85.81 | 89.13 | 23.9 | ×3.73 | **workload** | the two runs streamed different amounts in their 2 s window; the normalized metric is the comparison |
| software | `mainStream` | busy %/1k | 64.44 | 53.53 | 8.3 | ×6.45 | **real** (R2) | the app pins `scrollTop` per streamed frame — no reader event, no hold; the sky keeps painting |
| software | `mainStream` | p95 frame | 50.1 | 50 | 16.7 | ×2.99 | **workload** | the streamed window itself: 120 frames of ~50 ms either side, the sky-off control at 16.75 |
| software | `mainStream` | over33 | 34.5 | 44.5 | 1 | ×44.5 | **workload** | same window difference; per 1k chars the work fell, see the normalized row |
| software | `btwScroll` | busy % | 77.79 | 57.77 | 34.39 | ×1.68 | **real** (R3) | same mechanism as R1, on the side thread's own sky canvases |
| software | `btwScroll` | p95 frame | 33.4 | 33.4 | 16.75 | ×1.99 | **real** (R3) | same cell, same mechanism |
| software | `btwScroll` | over33 | 27 | 21 | 0 | 21 vs 0 | **real** (R3) | same cell: frames over two vsyncs, against zero with the sky off |
| software | `btwWheel` | over33 | 17.5 | 1 | 0 | 1 vs 0 | **noise** | a single 33.x ms frame out of ~122 in the window, and one in `css-off` too |

19 rows: 11 real (R1, R2, R3, R4, R5, R6), 3 workload, 5 noise. Every other cell-metric
pair is within 5% of its control or improved. The wheel cells also delivered the same scroll on both sides, so no
before/after difference above is a shorter gesture: the main wheel travelled ×0.98 / ×0.99 of `mainScroll`'s distance after (×0.98 / ×0.96 before); the side wheel ×0.99 / ×0.99 (×0.99 / ×0.97 before).

## 8. Render scale: which cells saw 0.45, and whether the two sides differ

The sky drops from `SCALE` 0.6 to `LOW_SCALE` 0.45 when its governor trips on a slow `gpuMs` (> ~24 ms). The scale is a
discrete mode and is recorded per cell (`<cell>.skyScale`, `<cell>.skyGpuMs`) and summarised per state; a median would
hide it.

- **Before (`before6.json`), gpu raster:** on: 0.6; off: 0.6; css-off: 0.45/0.6 (non-uniform).
  - `css-off` · repeat #3 (1-based, as the harness prints it): scale 0.45, windows at 0.45: mainScroll, mainWheel, mainTyping, mainStream, btwScroll, btwWheel, btwTyping, gpuMs 2.57
- **Before (`before6.json`), software raster:** on: 0.6; off: 0.6; css-off: 0.6.
- **After (`after7.json`), gpu raster:** on: 0.6; off: 0.6; css-off: 0.6.
- **After (`after7.json`), software raster:** on: 0.6; off: 0.6; css-off: 0.6.

**Does it differ between sides?** Not in the cells the verdicts rest on: `on` is 0.6 in every GPU and software cell on both sides, so every before/after `on` comparison in §3 is like-for-like.
No after-side `css-off` repeat ran at 0.45, so the isolation columns of §4 need no caveat this round.

## 9. Rejected repeats

The harness drops a repeat only when its **main-scroll** busy % exceeds 1.35× the best repeat of the same state (the
baseline keeps the least-contended repeats; interference can only add work). Both runs rejected nothing:
0 of 24 cells in `before6.json`, 0 of 24 in `after7.json`. The rule is scoped to `mainScroll` by design, so a
stall that lands in a *different* cell of an otherwise fine repeat is kept.

- `before6.json` · gpu · `css-off` · repeat #2: `btwScroll` busy 79.89 vs the state's median 39, p95 50.1 ms, 31 frames > 33 ms. Its `mainScroll` busy (17.83) was right at the state's best (17.61), so the rule had nothing to reject it on. It is kept and disclosed; it touches no `on` cell.

## 10. Limits

- **Chromium, not WebKitGTK.** The app ships in a WebKitGTK window; this harness drives Chromium for reproducibility (and
  because WebKit cannot run here). The two engines differ in compositor and in Event Timing coverage, so the numbers are a
  controlled before/after, not a prediction of the owner's absolute frame times. The software raster is a proxy for the
  GPU-fallback case, not for WebKit.
- **Trackpad pixel deltas.** `page.mouse.wheel` sends whole-notch deltas (120 px ramped, up to 480), not a trackpad's
  sub-pixel stream. The wheel cells are ramped to the programmatic cell's distance so the *workload* matches, but the event
  pattern is coarser than the owner's two-finger scroll.
- **Keyboard scrolling is not measured.** No cell drives `PageDown`/`ArrowDown`/`Space`; the hold covers keydown on the
  transcript, but a keyboard fling's rate and cadence are not in these numbers.
- **Machine load.** One box, one desktop; per-cell 1-min load was ≤ 2 before and ≤ 1.94 after, and the
  harness waits for ≤ 2 before each cell. That is a gate, not isolation: the 15-minute average still carried earlier work
  (8.55 at the after run's start). The two runs were sequential (before, then after), not randomized across the day.
- **Synthetic cells arm no hold.** `mainScroll` and `btwScroll` assign `scrollTop`; they measure the CSS removal and the
  floor the fix leaves, and they must not be read as the owner's gesture. Every verdict in §5 uses the wheel cell for that.
- **One machine, one GPU, one Chromium build.** Playwright 1.63.0, Chromium headless, viewport 1440x940;
  a different GPU or a different vsync interval moves the frame-interval thresholds (`over33` is 2 × 16.7 ms here).
- **The tree moved between round 6 and round 7, and only the after side was re-measured.** That is sound because the before
  side is a clean `git archive HEAD` of the same commit (no working-tree bytes at all), but it means the round-6→7 delta
  in §3.4 is the *only* evidence of what the mentions dedup and the `promptFit` move changed: the before side cannot
  separate them from the rest of the fix.

## 11. The one-line table to put in front of the owner

Busy % of the renderer's main thread inside each cell's window; control is the same cell with the sky off. "vs control"
is after-fix on ÷ after-fix off; "before" is the same ratio on the pre-fix tree. The reader rows are the owner's own
input; the synthetic rows are the floor the fix leaves when nothing arms the hold.

| complaint | cell | kind | gpu: before → after (vs control) | software: before → after (vs control) |
|---|---|---|---:|---:|
| transcript wheel | `mainWheel` | reader | 22.12 → **14.08** (×0.93; was ×1.56) | 52.31 → **16.82** (×1.08; was ×3.54) |
| transcript synthetic | `mainScroll` | synthetic | 34.63 → **17.99** (×0.86; was ×1.77) | 57.74 → **49.68** (×2.33; was ×2.76) |
| typing (main composer) | `mainTyping` | reader | 27.16 → **18.19** (×0.95; was ×1.51); slow events 20.5 → 15.5 of 40 | 53.99 → **18.12** (×0.92; was ×2.81); slow events 40 → 15.5 of 40 |
| streaming | `mainStream` | app | 11.43 → **8.56** (×1.04; was ×1.52) %/1k chars | 64.44 → **53.53** (×6.45; was ×7.88) %/1k chars |
| side wheel | `btwWheel` | reader | 20.74 → **14.53** (×0.73; was ×1.18) | 49.97 → **16.41** (×0.87; was ×2.8) |
| side synthetic | `btwScroll` | synthetic | 44.53 → **28.52** (×0.81; was ×1.41) | 77.79 → **57.77** (×1.68; was ×2.4) |

On the GPU every after-fix `on` cell sits at or below its control, so the GPU ratios below 1 mean "at control" and are
not measured speedups (§4); the software ratios above 1 are the residuals of §6.

Plain terms: **transcript scrolling with the wheel is at control on both rasters** (main-thread busy
22.12 → 14.08 GPU, 52.31 → 16.82 software, sky frames
16 → 0, frames > 33 ms 18.5 → 1 on software); the GPU number is
*below* its control (not a speedup, §4), and the software number is
×1.08 of it — 1.24 busy points left over. **Typing in the main composer is back at control on
main-thread work on both rasters** (27.16 → 18.19 GPU, 53.99 → 18.12 software), and the
keystroke-latency win is demonstrated on the software raster (p95 19.75 → 15.35 against
16.5 → 15.4, slow events 40 → 15.5 of 40; on the GPU the latency metrics showed no
pre-fix sky cost and the keystroke tail sits above its control, §5.2 and R6); **streaming is fixed on the GPU** and still heavy on software
(×6.45 its control, normalized); **the side panel stays smooth and its wheel is at control on both rasters**
(×0.73 / ×0.87, from ×1.18 / ×2.8); the visible residue is app-driven scrolling
(no reader event, so no hold), streaming on software, and the keystroke tails (R1, R2, R3, R4, R5, R6 — §6 lists each with its size).

## 12. Reproduce

```bash
cd /home/ehab/audit-pandacode/src          # the repo root, the directory that holds bench/

# 1) PRE-FIX: pristine HEAD into /tmp, served by the same harness (unchanged since round 6)
rm -rf /tmp/perf-final6 && mkdir -p /tmp/perf-final6
git archive HEAD | tar -x -C /tmp/perf-final6
node bench/perf-lag/run.mjs --worktree /tmp/perf-final6 --repeats 4 \
  --out bench/perf-lag/results/before6.json

# 2) AFTER: this checkout, the tree on disk (round 7)
node bench/perf-lag/run.mjs --repeats 4 \
  --out bench/perf-lag/results/after7.json
```

The after command was run exactly as above, on the quiet box described in §0. The harness starts its own vite on :1420
(`cwd` = the served tree), says so, and kills it at the end; the `--worktree` tree gets a `node_modules` symlink
(untracked, gitignored, no git state written). Contrast the pair with:

```bash
node -e 'for (const f of ["before6","after7"]) { const d = require("./bench/perf-lag/results/"+f+".json");
  console.log(f, d.env.harness.slice(0,12), d.env.commit.slice(0,12), d.env.srcTree.slice(0,12), d.modes.gpu.renderer) }'
```

Files in this directory after round 7: `before6.json`, `after7.json`, `round7-comparison.md` — and nothing else.
Deleted with round 7: `after6.json` (round 6's after-side JSON, superseded by `after7.json`) and `round6-comparison.md`
(round 6's record, superseded here; it was the file that pinned the stale `srcTree 43c627558ce2…`). `before6.json` is kept
because the before side did not change: it is still the clean-HEAD half of the pair, produced by the same harness at the
same commit. The round-6 side of §3.4 was read from `after6.json` before it was pruned, so §3.4's tables are the only
place those numbers survive on disk; they are quoted for the delta and for nothing else.

