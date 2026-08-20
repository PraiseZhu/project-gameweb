# Final user-preview gate

`preview-first` proves that a candidate product view can render meaningful
Figma-derived content in internal headless Chrome. It is not a delivery gate.
Its screenshot, product-view URL, and launch command are internal evidence only.

## Final-ready input

The final gate requires static acceptance, complete visual assets, the complete
visual evidence chain, and one matching reviewed `finalEvidence` artifact:

```json
{
  "staticAcceptance": {
    "complete": true,
    "accepted": true,
    "partial": false,
    "staticAcceptanceId": "opaque-final-static-revision"
  },
  "finalEvidence": {
    "accepted": true,
    "evidenceLevel": "confirmed-final",
    "staticAcceptanceId": "opaque-final-static-revision"
  }
}
```

`report.ok` and `report.evidenceLevel` are not substitutes for `finalEvidence`.
The gate never falls back to an unrelated report to authorize user preview.
If `finalEvidence` is absent, not accepted, or does not have the required
evidence level, the gate blocks with `final-evidence-not-confirmed`. When
`staticAcceptance.staticAcceptanceId` is a non-empty string,
`finalEvidence.staticAcceptanceId` is mandatory and must be exactly equal; a
missing or different value blocks with `final-evidence-static-acceptance-mismatch`.

Missing static acceptance, missing/incomplete visual assets, candidate or
unverified evidence, partial output, or missing Figma/local raster comparison
exits blocked with `userPreviewAllowed:false`. The gate only evaluates metadata
and opaque references; it never reads, derives, or carries seasonal geometry,
assets, source trees, or Figma node identifiers. Candidate URLs must remain
internal-only and must not be presented to the user.

Run:

```bash
node scripts/final-preview.mjs --input <final-preview-input.json>
```

A separate report may be retained for diagnostics, but it is never sufficient to
open a final user preview by itself.
