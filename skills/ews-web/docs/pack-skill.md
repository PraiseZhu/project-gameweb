# EWS Pack

Pack runs after stop 1 is accepted and before stop 2. It is a **trusted single-process build**: one Pack CLI copies a frozen demo into an isolated work tree, compresses that copy, then publishes a separate delivery directory. It does **not** write back to the frozen input.

## Inputs and outputs

| Tree | Role |
|---|---|
| `--demo` | Frozen stop-1 page. Read-only for Pack. Never mutated. |
| `<out-basename>.pack-work-*` | Sibling of `--out` (Torchlight `workDirFor` shape). Image recompress, font subset, gzip, and the served manifest happen here. |
| `--out` | Final delivery. Same last-segment name is kept; Pack copies into it with `replaceDirContents` instead of renaming the directory. |
| `<out>.pack-proof.model.json`, `<out>.pack-proof.provenance.json`, `<out>.pack-report.json` | Proof/report **outside** the served folder. Not in the served manifest. |

`--out` must be a new last path segment. Its parent must already exist as a real directory (not a junction/symlink). Pack does not create missing parents. `--demo` and `--out` must not overlap.

## What Pack does (user-visible)

Recompress referenced images (including existing WebP) at quality 90; lossless for slices ≤200KiB. SHA-identical images are merged and references rewritten. Subset every referenced font from the union of page HTML and model text (all locales, including variant trees collected before those trees are stripped). Lossless gzip of the runtime model to `model.json.gz`. Boot decodes with DecompressionStream; failure sets `data-ews-qa=boot-failed`. Served folder ≤15MB, no exceptions. Image pixel dimensions are never reduced to meet the budget. Numeric text tokens and `font-size` declarations must match the frozen snapshot. Missing Python Pillow or fontTools is a failure, not a skip. Path rewrites must not double-replace a source that is a prefix of its destination.

Stop 2 uses the **delivery** hash, not stop 1 `inputHash`. Do not repack after stop 2. `npm run pack` does not read `human-review.json`; operators must not Pack before stop 1 is accepted, and tests must not write `accepted=true`.

## Commit and cleanup

1. Copy frozen `--demo` into the sibling pack-work directory.
2. Mutate only pack-work.
3. Freeze a relative served manifest (`path` / `type` / `size` / `sha256`).
4. Backup the new `--out` (empty), `replaceDirContents(workDir, out)` (Torchlight commit shape; keeps the directory name for Windows EPERM on rename).
5. Copy proof/report beside `--out` with `COPYFILE_EXCL`.
6. Re-read the real delivery: **every** served file is in the frozen manifest (no prefix skip). Layout, per-file SHA/size, and total bytes must match and stay ≤15MiB. Extra or missing files fail the publish.
7. On failure, restore `--out` from the copy backup. If the backup cannot be deleted after a successful commit, Pack **reports** the leftover path and does not pretend the temp is gone.
8. Registered temps (pack-work, work-proof, work-report) are removed in `finally`. `encode-webp` job dirs under `%TEMP%/ews-webp-*` are removed in `finally`; cleanup failure is reported, not swallowed.
9. After gzip-loader injection, Pack restamps `runtime/*` imports and `index.html` `boot.mjs` / `ews.css` `?v=` from the packed runtime identity so a same-URL cache cannot keep the frozen boot.

Reserved names inside `--demo` / pack-work are exact paths `.ews-pack-report.json` and `.ews-pack-proof` (file or directory). Collision fail-closed; Pack does not omit those names from the manifest while still copying them. Sidecars live **outside** `--out` (`<out>.pack-proof.model.json`, …). A user file such as `.ews-pack-proof-budget.bin` is a normal served file and counts toward 15MB.

If `<out>.pack-backup-<pid>` already exists, Pack refuses and does not delete the sentinel.

## Threat model (write this down; do not inflate it)

Pack is a **trusted single-process builder**. Same-user `icacls` / ACL reset, concurrent tampering of paths behind the running process, and kernel TOCTOU against the builder itself are **out of scope**. They are not a product HIGH and must not be “fixed” with pseudo-locks.

Ordinary **fail-closed preflight** still applies:

- Refuse symlinks inside `--demo` and pack-work.
- Refuse `--out` parent/ancestors that are junctions or directory links.
- Refuse preexisting `--out` and preexisting proof/report sidecars (do not overwrite foreign files).
- Stay inside the staged copy (`realpath`, no path traversal).
- Non-Windows uses the same path publish; there is no second “security helper”.

Removed: Win32 dirbox, HOLD/SEAL/ACL deny, drive-root handle chains, and other unused path-lock complexity. Those claimed a same-user race boundary Node cannot honestly provide.

Run `npm run pack -- --demo <frozen-demo> --out <delivery-dir> --budget-mb 15`.
