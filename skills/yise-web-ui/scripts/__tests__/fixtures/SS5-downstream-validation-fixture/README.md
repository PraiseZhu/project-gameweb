# SS5 downstream validation fixture

This directory is an explicitly isolated **test fixture**, not production SS5 inventory/truth/handoff.

## What it proves

- A caller-owned, source-backed interaction model can be converted into the renderer payload.
- The renderer can consume a valid direct-child switch contract with four pages.
- The payload preserves source-selected initial state and explicit `tab/`, `ind/`, `prev`, and `next` mappings.
- An incomplete or mismatched model remains inert instead of guessing a page or transition.

## What it does not prove

- It does not prove fresh Figma → `inventory/v2` completeness.
- It does not produce a `ready` inventory or production handoff fingerprint.
- It does not prove SS5 visual/static acceptance, assets, fonts, responsive acceptance, or official-site parity.
- It does not use old screenshots, stale handoff data, guessed node IDs, or production inventory artifacts.

The IDs and control facts are limited to the already source-backed SS5 interaction families: `switch/源器`, `tab/源器`, `switch/角色`, `tab/角色`, `ind/进度条`, `btn/prev`, and `btn/next`. The fixture is disposable and may be deleted after downstream validation.
