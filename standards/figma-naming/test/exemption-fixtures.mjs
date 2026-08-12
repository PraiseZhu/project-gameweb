import { SPEC_VERSION } from "../src/spec.mjs";

/** 测试专用豁免。生产账本必须来自设计师判断 → agent 归纳 → 用户批准。 */
export function btnIconExemption(overrides = {}) {
  return {
    id: "ex-img-fill-btn-instance-under-40",
    rule: "N-IMG-FILL-NO-NAME",
    reason: "按钮内的小图标由主组件统一命名，实例里改不了",
    createdAt: "2026-08-06",
    reviewBy: "2026-11-06",
    specVersion: SPEC_VERSION,
    condition: {
      inInstance: true,
      nearestPrefix: ["btn"],
      sizeRange: { maxEdgeLt: 40 },
    },
    ...overrides,
  };
}

export function emptyLedger() {
  return { version: 1, active: [], candidate: [] };
}

export function btnIconLedger() {
  return { version: 1, active: [btnIconExemption()], candidate: [] };
}
