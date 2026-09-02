// Generated from DESIGN.md YAML. Do not edit by hand.
// Regenerate: node standards/design-policy/tool/src/write-skill-policy.mjs <DESIGN.md> <out.mjs>
export const DESIGN_POLICY = Object.freeze({
  "schema": "gameweb-design-policy/v1",
  "path": "skills/yise-web-ui/DESIGN.md",
  "designWidths": {
    "mobile": 750,
    "pad": 3840,
    "pc": 3840
  },
  "officialRootFontVw": 10,
  "heroViewportFillVh": 100,
  "composition": [
    {
      "key": "mobile",
      "min": 0,
      "max": 750
    },
    {
      "key": "tablet",
      "min": 751,
      "max": 1023
    },
    {
      "key": "desktop",
      "min": 1024,
      "max": null
    }
  ],
  "qaBuckets": [
    {
      "key": "mobile",
      "min": 0,
      "max": 750
    },
    {
      "key": "tablet",
      "min": 751,
      "max": 1023
    },
    {
      "key": "desktop",
      "min": 1024,
      "max": null
    }
  ],
  "inventPadTree": false,
  "padUsesPcTree": true,
  "localeFontScale": {
    "body": {
      "zh-CN": 1,
      "en": 0.8,
      "ja": 0.8,
      "ko": 0.8,
      "zh-TW": 1
    },
    "card-title": {
      "zh-CN": 1,
      "en": 1,
      "ja": 0.833,
      "ko": 1,
      "zh-TW": 0.833
    },
    "heading": {
      "zh-CN": 1,
      "en": 1,
      "ja": 1,
      "ko": 1,
      "zh-TW": 1
    }
  },
  "tierRules": {
    "bodyMaxWeightExclusive": 600,
    "cardTitleMinSourcePxExclusive": 40
  },
  "shrinkSteps": [
    100,
    92,
    85,
    78,
    75
  ],
  "shrinkFloorPercent": 75,
  "hugNoShrink": true,
  "openFlowNoShrink": true
});
