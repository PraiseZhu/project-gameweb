# Final user-preview gate

`preview-first` proves that a candidate product view can render meaningful
Figma-derived content in internal headless Chrome. It is not a delivery gate.
Its screenshot, product-view URL, and launch command are internal evidence only:

```json
{
  "userPreviewAllowed": false,
  "previewDisposition": "internal-candidate-only",
  "evidenceLevel": "candidate"
}
```

Do not open or present a candidate URL to the user.

## Final-ready input

Use the final gate after the static workflow and final evidence have completed:

```json
{
  "staticAcceptance": {
    "complete": true,
    "accepted": true,
    "partial": false,
    "staticAcceptanceId": "opaque-final-static-revision",
    "staticTruthRef": "opaque-static-artifact-reference"
  },
  "visualAssetAudit": {
    "visualAssetsComplete": true,
    "complete": true
  },
  "report": {
    "ok": true,
    "partial": false,
    "evidenceLevel": "confirmed-final"
  }
}
```

Run:

```bash
node scripts/final-preview.mjs --input <final-preview-input.json>
```

The result permits a user preview only when all of these are true:

1. static acceptance is both `complete` and `accepted`;
2. the separate static visual-asset audit has `visualAssetsComplete: true` and `complete: true`;
3. no static or report output is `partial`;
4. final evidence is accepted and has `evidenceLevel: "confirmed-final"`.

Missing static acceptance, missing/incomplete visual assets, candidate or unverified evidence, partial output, or missing final evidence exits blocked with `userPreviewAllowed:false`. The gate only evaluates metadata and opaque references; it never reads, derives, or carries seasonal geometry, assets, source trees, or Figma node identifiers.
