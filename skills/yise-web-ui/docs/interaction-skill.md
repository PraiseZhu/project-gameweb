# Interaction Skill

This is the rename of the former Motion Skill. The code is unchanged in this
pass. The Etheria demo is only a fixture consumer.

The public runtime is still:

- `scripts/lib/figma-interaction-contract.mjs` — click, switch/page, tab,
  indicator, hscroll, directory / scrollspy
- `scripts/lib/motion-contract.mjs` — retained motion patterns
- `scripts/lib/hero-scroll-slot.mjs` — hero lock/exit/release geometry, shared
  with Resize for window-size changes
- `scripts/lib/motion-role.mjs` and `scripts/lib/figma-motion-browser-check.mjs`

File names stay as they are so existing imports do not break. New text must say
**Interaction Skill**, not Motion Skill.

## What this Skill will own

User-visible behavior after the static Figma page is already on screen:

- directory click-to-section and scrollspy
- switch / tab / component-set immediate replacement
- horizontal scroll / carousel only when Main has a source-backed graph
- later: calendar reveal, character switch, and other timed effects

## What this Skill does not own yet

This pass only renames the capability. It does not:

- unfreeze the old Motion fallback
- move files
- change renderer wiring
- claim that stretch, typography, or Figma fetch belong here

Hero lock/exit/release **geometry while the window size changes** is owned by
Resize. Interaction may consume that state; it must not invent a second scroll
model.

## Status

Waiting for a later modification pass. Until then, treat existing contracts as
frozen references and keep fail-closed: missing source structure stays
unresolved, never guessed.
