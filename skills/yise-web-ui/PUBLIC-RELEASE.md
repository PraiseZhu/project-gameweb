# yise-web-ui Public Release Boundary

`yise-web-ui` is the canonical identity of this reusable Figma-to-Web UI verification Skill. It is a Skill and verification toolchain, not an AppStore app. `demos/yise-ss5-preview` is an Etheria/伊瑟 example used for local verification only.

## Publish

The publishable generic surface is listed mechanically in `public-release.json`: `SKILL.md`, `README.md`, `LICENSE`, package metadata and lockfile, reusable `scripts/`, reusable `templates/`, reviewed generic `docs/`, and the bundled runtime fonts in `fonts/`.

The release audit is deterministic and fail-closed:

```bash
npm run release:audit
```

It checks identity metadata, the explicit private boundary, and credential/machine-path patterns in publishable files. Passing the audit is a release-boundary check, not GitHub publication and not visual completion.

The Skill is organized as a Main Skill (complete Figma extraction, structure,
behavior wiring, Demo接线, and final review), an independent Translation Skill,
frozen Motion code used only as a documented fallback, and an optional Figma
Prototype Truth Audit. Motion files remain publishable and are not deleted, but
the default release flow does not invoke a Motion Worker. `explicit-empty`,
`field-absent`, and `unavailable` prototype snapshots are reported as
unverified evidence and do not block a normal release; `--require-observed` is
fail-closed only when an explicit prototype audit is requested.

Main Skill includes truth-backed fixed-directory navigation: click-to-section,
scrollspy selection, click-lock release, and active/normal Figma variant use.
It only activates from complete owner and section inventory evidence; unresolved
structure is reported rather than converted into a page-specific interaction.

## Keep private

Do not publish demo fixtures, Figma/Lark captures, generated `truth.json` or `index.html`, exported assets, browser screenshots, audit evidence, local evolution cases, `.env`, tokens, cookies, private URLs, absolute machine paths, `node_modules/`, or temporary output. Existing local artifacts are intentionally preserved; this manifest does not delete them.

`FIGMA-ADAPT.md` and `qa-hifi-demo` references are historical upstream context, not a second public Skill identity. They remain outside the publishable set unless separately reviewed and rewritten.

## Runtime fonts (bundled)

Fonts are runtime dependencies, not page assets. Two layers give a clone deterministic offline fidelity:
(1) the currently verified font binaries are bundled in `fonts/` and recorded in `fonts/registry.json` (family → file, postScriptName, weight, source, license, sha256, bytes);
(2) `npm run fonts:check` / `npm run fonts:install` validate every bundled file against the registry (existence, byte size, sha256, family/weight mapping) and print a source-driven reinstall guide for any missing or hash-mismatched file.

Fonts whose redistribution license is not confirmed are reported by `fonts:check` under `licenseReview` and are NOT claimed safe to redistribute. Currently two CJK free-commercial families (`Alimama ShuHeiTi`, `FontquanXinYiGuanHeiTi`) carry a `licenseReview` marker pending manual confirmation from the rights holder. Do not silently treat them as cleared.

## Copy status

The current copy chain is wired: `truth.copy.byNode` and `extract-report.copy` are emitted from Figma and Lark fixtures through `scripts/lib/figma-copy-adapter.mjs`. Current local evidence reports 115 PC `byNode` entries, 251 unresolved/unread items, and 5 contextual records. Unresolved means the adapter refuses to guess; it requires explicit designation or human semantic review. Official web text does not override Figma static truth.

No release claim should convert unresolved copy into a pass, and no human semantic review is replaced by this audit.

## Typography status

Typography is audited separately from copy mapping. The reusable translation contract is in `docs/translation-skill-typography.md`, with the public interface at `scripts/lib/translation/index.mjs`; the browser collector remains documented in `docs/typography-diagnostics.md`. The current local Figma font dry-run has one explicit gap: `Noto Sans HK` weight `700` is missing for one source text node. Do not replace it silently or publish a visual-fidelity claim until a reviewed/licensed font source is available. Real Chrome evidence is required; Node/DOM counts alone are insufficient.
