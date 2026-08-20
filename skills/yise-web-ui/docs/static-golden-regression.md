# Static golden regression

A static golden baseline protects an already accepted **default** page state from
later renderer, chrome, interaction, resize, or template changes. It is a
regression input, not a template: the baseline records only opaque source and
fingerprint references, screenshot/region references, and tolerances. Raw x/y,
CSS, rectangles, offsets, or older-season layout values are rejected.

## Register the immutable SS6 fixture

Do not edit `0813 SS6赛季/ss6-season-demo`. Create a separate baseline manifest
alongside the acceptance evidence (or in another controlled artifact location):

```js
import { registerStaticGoldenBaseline } from './scripts/lib/static-golden-regression.mjs';

const baseline = registerStaticGoldenBaseline({
  demoRef: 'fixture://0813-ss6-season-demo/accepted-static-r1',
  roots: [
    {
      platform: 'pc', state: 'default', viewport: { width: 1920, height: 1080 },
      staticAcceptanceId: 'accepted-static-pc-r1',
      figmaRootRef: 'figma://accepted/ss6/pc-root',
      truthRef: 'truth://0813-ss6/pc/default',
      fingerprint: { font: 'sha256:...', asset: 'sha256:...', owner: 'sha256:...', geometry: 'sha256:...' },
      visual: {
        screenshot: { reference: 'artifact://ss6/pc.png', sha256: 'sha256:...' },
        regions: [{ key: 'default-root', reference: 'artifact://ss6/pc-default-root.png', sha256: 'sha256:...' }],
      },
      tolerances: { maxDiffRatio: 0.005, geometryTolerance: 2 },
    },
    // Register mobile as a distinct root and viewport. Never reuse PC evidence.
  ],
});
```

The example identifiers are placeholders. Capture the hashes/references from
accepted evidence. The fixture reference and its Figma/truth roots are opaque;
they cannot affect a new season's renderer geometry.

## Evaluate a current static candidate

A browser/pixel collector writes a candidate manifest with `capability.browser`
and `capability.pixel`, both set to `true` only after real collection. Each root
must bind the same platform, viewport, default state, source references,
fingerprints, screenshot reference/hash, and region comparison evidence.

```bash
node scripts/static-golden-regression.mjs \
  --baseline <accepted-golden-baseline.json> \
  --candidate <current-static-candidate.json> \
  --out <golden-regression-report.json>
```

Exit `0` means every registered platform passed independently. Exit `2` means
blocked or regressed. Examples include a missing mobile candidate, an incorrect
viewport/default state, missing screenshot or region comparison evidence, any
font/asset/owner/geometry fingerprint mismatch, or a diff ratio above the
registered tolerance. A browser or pixel capability absence returns an explicit
blocked reason; it is never treated as a pass.

## Behavior and renderer upgrades

Use `requireGoldenStaticAcceptanceForBehavior()` before a behavior layer claims
non-regression. It accepts only a successful golden evaluation. A changed static
fingerprint or source binding returns `staticReacceptanceRequired:true`; create a
fresh static acceptance/baseline rather than silently replacing the previous one.
