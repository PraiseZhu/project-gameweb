/**
 * Snapshot EWS screen-runtime numbers for design-policy mirror.
 * Does not copy the shared parser. Shared tools are resolved from the repo
 * and missing tools fail closed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const DESIGN_POLICY_TOOL_RELS = Object.freeze([
  '../../standards/design-policy/tool/src/parse-design-policy.mjs',
  '../../standards/design-policy/tool/src/mirror-design-policy.mjs',
  '../../standards/design-policy/tool/src/write-skill-policy.mjs',
]);

export function resolveDesignPolicyTools(skillRoot) {
  const problems = [];
  const abs = {};
  for (const rel of DESIGN_POLICY_TOOL_RELS) {
    const path = resolve(skillRoot, rel);
    if (!existsSync(path)) problems.push(`缺少仓内 design-policy 工具：${rel}（缺失不得 skip）`);
    else if (rel.endsWith('parse-design-policy.mjs')) abs.parsePath = path;
    else if (rel.endsWith('mirror-design-policy.mjs')) abs.mirrorPath = path;
    else abs.writePath = path;
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, ...abs };
}

export function ewsImplementationFromRuntime({ runtime, runtimeSource, generated } = {}) {
  const problems = [];
  if (!runtime || typeof runtime !== 'object') problems.push('missing EWS screen runtime');
  if (!generated || generated.schema !== 'ews-design-policy/v1') {
    problems.push('missing ews-design-policy/v1 generated snapshot');
  }
  const source = String(runtimeSource ?? '');
  if (!/from\s+['\"]\.\/design-policy\.generated\.mjs['\"]/.test(source)) {
    problems.push('runtime 未 import design-policy.generated.mjs');
  }
  if (/export const MOBILE_MAX_WIDTH = 750/.test(source)) {
    problems.push('runtime 仍硬编码 MOBILE_MAX_WIDTH = 750');
  }
  if (!/innerHeight/.test(source)) problems.push('runtime 未使用 innerHeight');
  if (/--ews-screen-h['\"]?\s*,\s*[`'"][^`'"]*100vh/.test(source)) {
    problems.push('runtime 用 100vh 代替 innerHeight');
  }
  if (runtime?.SCREEN_HEIGHT !== 'innerHeight') {
    problems.push(`runtime SCREEN_HEIGHT ${runtime?.SCREEN_HEIGHT} != innerHeight`);
  }
  if (!/export function canvasScale/.test(source) || !/designRootFontPx/.test(source)) {
    problems.push('runtime 未用根字号驱动画布缩放 canvasScale');
  }
  if (!/bleedObjectPosition/.test(source)) {
    problems.push('runtime 未声明满铺背景 object-position');
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    snapshot: {
      schema: generated.schema,
      mobileMaxWidth: runtime.MOBILE_MAX_WIDTH,
      rootFontVw: runtime.ROOT_FONT_VW,
      wideAspectMin: runtime.WIDE_ASPECT,
      wideRootFontVh: runtime.WIDE_ROOT_FONT_VH,
      screenHeight: runtime.SCREEN_HEIGHT,
    },
  };
}
