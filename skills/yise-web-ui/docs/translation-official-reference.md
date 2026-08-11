# Official Behavior Reference

The official page `https://yise.xd.cn/` is behavior/source evidence only. It
does not replace Figma truth, translation fixtures, or browser measurements.
The following observations were captured on `2026-08-06` from the page text:

- The page exposes section-oriented navigation labels: 首页、活动日历、SS5
  突然一夏、特别活动、新源器、新玩法、全新异格者、新内容、新觉醒、RTA、体验优化.
- Activity content is repeated as reusable event-card categories, including
  新赛季启程庆典、SS5 赛季奖励 and 热浪音乐庆典, with descriptions.
- Source器 descriptions repeat by item and include 溢流、亵渎、猛毒、逐光、不屈之誓、沸腾打击.
- Character/skill content includes role names and skill labels such as 二相棘、驭刃、刃雨如潮、完美切割.
- The extracted text contains both compact and expanded line forms for some
  descriptions. This is evidence for range/wrap regression coverage, not proof
  of a particular responsive implementation.

The extracted page text has no locale selector. Therefore this reference does
not assert official locale-switch behavior, font weights, or language fallback.
Those remain separate Figma truth + Lark copy + real Chrome evidence gates.

The stable evidence schema may carry these observations through
`behaviorReference` in `translation-chrome-evidence/v1`; screenshots remain
optional evidence and `visualClaims.status` stays `unverified` without one.
