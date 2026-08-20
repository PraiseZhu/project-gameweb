# Figma sibling state candidates

A page extraction usually starts from a default device/page root. Visible sibling
frames on the same Figma page/canvas can nevertheless represent visual states
such as a menu or language popup. They must be retained for audit rather than
silently dropped.

A retained candidate is **not** an interaction contract. Matching labels, state
variants, a component set, relative location, or a visible popup never proves
that clicking a control opens it. Candidate output always separates:

- `visualStateDiscovered:true` — a same-scope source frame was retained;
- `transitionAuthorized:false` — until a determined prototype edge or explicit
  state map supplies exact structural evidence.

## Audit input and CLI

```bash
node scripts/figma-state-candidate-audit.mjs \
  --input <state-candidate-audit-input.json> \
  --out <state-candidate-audit.json>
```

The input has `nodes`, `platformRoots`, and `controls`. Each root carries its
node id, platform, page/canvas ids, and parent. Each visible stateful control is
audited independently. The report classifies it as:

- `wired` — an exact, determined prototype transition or explicit state map
  points to a candidate on the same platform;
- `recognized-but-evidence-insufficient` — an explicit relation is unresolved,
  ambiguous, or cross-platform;
- `input-state-relation-missing` — no authorizing relation exists;
- `unsupported-by-renderer` — the state relation may be known but this renderer
  cannot support it.

A later review can add `stateMaps` with `controlKey`, `candidateId`, and
inspectable evidence to the saved audit input. This joins the existing candidate
artifact without another Figma extraction. The map remains platform-scoped.

A `nav-scroll` success, other aggregate runtime signal, or `inert:true` safety
result cannot change any control status. Inert output is recorded as
`safe-blocking-not-interaction-completion`; incomplete controls remain blocked.
