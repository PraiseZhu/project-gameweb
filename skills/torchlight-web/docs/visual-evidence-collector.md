# Canonical visual evidence collector

The final preview gate requires inspectable evidence, not aggregate booleans. The canonical collector consumes a runtime snapshot captured by a real browser collector and source references from the accepted Figma/truth artifacts.

## CLI

```bash
node scripts/lib/visual-evidence-collector.mjs \
  --input <runtime-snapshot.json> \
  --out <final-visual-evidence.json>
```

A missing or malformed snapshot exits non-zero and emits a blocked diagnostic. Missing Figma region images, browser font delivery, internal scroll facts, fixed-chrome measurements, interaction observations, resize measurements, or crop/plane policies remain `complete:false`; the collector never invents PASS records.

The output fields are the exact inputs consumed by `evaluateFinalVisualEvidenceChain`:

```text
typography
pageFlow
fixedChrome
resize
interaction
comparison
```

Each sub-record carries a schema, platform/viewport where available, source references, `complete`, `blocked`, and inspectable `failures`. Runtime snapshots must be produced by real browser instrumentation; synthetic fixtures are only for deterministic collector tests.

Focused tests:

```bash
node --test scripts/__tests__/visual-evidence-collector.test.mjs
```
