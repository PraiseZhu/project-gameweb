# Pack Skill（交付压缩）

This is a **delivery step**, not a fourth restore axis. Main static,
Translation, Interaction, and Resize still stop for human acceptance on
source-fidelity assets. Pack runs only after Resize is accepted **and** the
second human review stop (`interaction-and-resize` in `human-review.json`)
is accepted. Missing either fails before mutation.

SS6 4173 / `yise-ss6-web` is a fixture consumer. No rule here may depend on
Etheria node IDs. Indicator fallback files are a generic runtime contract:
any `figma-indicator-*.png` (or later `.webp`) referenced from the demo root
or `assets/` is a served file, not audit junk.

## Why it sits after Resize

- Static / Translation / Interaction / Resize must be accepted against the
  geometry PNG and lossless-or-q90 WebP delivery, not against the 15MB pack.
- Pack mutates bytes: lossy WebP, font subset/woff2, SHA collapse, truth
  externalize, dropping non-runtime files. Doing that before Resize means
  later axes rewrite refs and the pack has to run again.
- 2026-08-25: packing mid-restore deleted `figma-indicator-*-alpha.png` and
  the progress marks rendered as broken images plus the layer name
  `ind/进度条`. Fallback assets must stay in the served tree.

## Two volume gates (do not mix)

| Gate | When | What it measures | Default |
| --- | --- | --- | --- |
| HTML volume | Main inline / truth embed | `index.html` itself | 10MB. Over limit → `#qa-truth data-src="truth.json"` |
| Pack volume | After Resize accepted | whole served demo folder | 15MB. Assets folder **is** counted here |

Main still exports WebP at slice time (alpha lossless, opaque q90) and keeps
PNG as geometry proof. That is **not** the 15MB pack. Do not crank slice
export to pack quality so static review happens on crushed art.

## What Pack owns

1. Re-encode unique PNG proof **and current WebP** as lossy WebP, keep alpha.
   Default pack quality **70**. Pack must pass `lossless: false` so the
   shared encoder does not keep the slice-time “alpha → lossless” default.
   Encode only images still referenced after runtime rewrite; leftover
   PNG/WebP is deleted by the unreferenced pass. Skip a file only if the
   new bytes ≥ the **current** file. Slice-time lossless/q90 WebP is not
   a skip reason.
2. Collapse SHA-identical images to one file; retarget `qa-assets`,
   `truth.json`, and hardcoded fallback paths. Drop extract-only
   `lib/` / `scripts/` and the build-time `assets-manifest.json`.
3. Subset fonts to page TEXT + ASCII + the other locales' copy, write woff2,
   rewrite `#qa-fonts`. Do not silently swap a missing family. Do not drop
   JP/KR/HK fonts to pass the budget. Compact `fonts-manifest.json` notes
   and long missing-font copy, but keep `sha256`, `bytes`, `totalBytes`,
   and `missing.family` so chrome font authenticity checks still work.
4. Compact `truth.json` and always externalize `#qa-truth` for the packed
   demo (HTTP preview / XD Sites). file:// single-file is no longer the pack
   target. Compact `#qa-assets` JSON (drop default `exportBounds`, collapse
   file-only records) but keep `assets/` paths and `exportBox`.
5. Keep runtime fallback files (`figma-indicator-*.png` / `.webp`, calendar
   fallback slices). After rewrite, delete unreferenced image files. Move
   only audit/probe/screenshot trees out.
6. Fail if the served folder **after mutation** exceeds 15MB, or if any
   `qa-assets` / fallback path 404s. `--dry-run` reports current bytes and
   planned actions; it must not fail because the working folder is still
   over 15MB before compression. Over-budget live failures print a
   webp/png/truth/fonts/html/other breakdown. Lower quality only via
   explicit `--quality`.
7. Refuse symlink / junction / reparse-point inputs before any recursive
   read, rewrite, convert, or unlink. Realpath of every file must stay inside
   the pack worktree.
8. Runtime reference gates recurse HTML, CSS, JS, MJS, and JSON. A leftover
   packed asset path in a script or JSON file is a pack failure. Only
   root-relative `/...` paths resolve from the demo root; CSS/JS/JSON paths
   without a leading `/` stay relative to that file. Quoted local names may
   contain spaces; only srcset descriptors split on whitespace.
9. After a successful swap, leftover backup cleanup is outside the rollback
   critical section. Cleanup failure keeps the new demo and reports the leftover
   backup; it must not delete the new demo and restore a half-removed backup.

## What Pack does not own

- Figma fetch, static geometry, locale decisions, click wiring, stretch
- Official-site compressor quality tables (still waiting on the builder file)
- Inventing a fourth restore Skill or renaming Resize

## Command

```bash
node scripts/pack-demo.mjs --demo <dir>
node scripts/pack-demo.mjs --demo <dir> --quality 70 --budget-mb 15 --dry-run
```

PNG sources move to `<demo>-png-proof/` (or `data/assets-png/` when that
already exists). Packed bytes stay in the demo folder that XD Sites uploads.

## Evidence

A pack claim needs:

- `bytesBefore` / `bytesAfter`, with `bytesAfter` ≤ budget
- `images.reencodedWebp` (existing WebP re-encoded at pack quality)
- `images.convertedPng` and `images.duplicates`
- `fonts.glyphs` / `fonts.bytesAfter`
- `truth.bytesAfter`
- `unreferenced.removed`
- every `qa-assets` path and every `figma-indicator-*` fallback exists
- a Chrome open of the packed `index.html` (progress marks must not show the
  layer name `ind/进度条` as visible text)

A claim without `images.reencodedWebp` did not re-encode existing WebP.

A green Main HTML-10MB gate is not a pack pass.
