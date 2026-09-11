/**
 * Torchlight adapter for the shared stop-1 Figma pixel gate.
 * Shared default skip covers Yise re-exports. This file owns Torch's skip and overwrites the env.
 * Callers: figma-html-from-handoff.mjs attachStop1FigmaPixelGate;
 *   stop1-figma-pixel-probe.mjs; scripts/__tests__/stop1-figma-pixel-gate.test.mjs.
 * Schema: stop1-figma-pixel-gate/v1. Source: standards/stop1-figma-pixel/tool/src.
 */
export * from '../../../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-gate.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isStop1PixelSkippedSection as sharedIsStop1PixelSkippedSection,
  runStop1FigmaPixelGate as sharedRunStop1FigmaPixelGate,
} from '../../../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-gate.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/* Draft copy on this later mobile section is wrong in Figma
 * (嘉年华直播目录 vs Lark 赛季前瞻直面会). User: skip this screen
 * this round; other screens stay at 0.50%. Torch-only. */
export const STOP1_PIXEL_SKIP_SECTIONS = Object.freeze({
  mobile: Object.freeze(['949:6041']),
});

export function isStop1PixelSkippedSection(platform, secId) {
  return sharedIsStop1PixelSkippedSection(platform, secId, STOP1_PIXEL_SKIP_SECTIONS);
}

export function injectTorchStop1SkipEnv() {
  process.env.STOP1_PIXEL_SKIP_JSON = JSON.stringify(STOP1_PIXEL_SKIP_SECTIONS);
  process.env.PLAYWRIGHT_MODULE_ROOT = SKILL_ROOT;
}

export function runStop1FigmaPixelGate(opts) {
  injectTorchStop1SkipEnv();
  return sharedRunStop1FigmaPixelGate(opts);
}
