#!/usr/bin/env node
/**
 * Re-export the shared stop-1 Figma pixel probe.
 * Callers: stop1-figma-pixel-gate defaultLiveProbe; hand-run from stop-1;
 *   scripts/__tests__/stop1-figma-pixel-gate.test.mjs spawnSync.
 * Schema: stop1-figma-pixel-gate/v1. Source: standards/stop1-figma-pixel/tool/src.
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
export * from '../../../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-probe.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  failStop1FigmaPixelProbe,
  runStop1FigmaPixelProbeCli,
} from '../../../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-probe.mjs';
import { injectTorchStop1SkipEnv } from './stop1-figma-pixel-gate.mjs';

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  injectTorchStop1SkipEnv();
  runStop1FigmaPixelProbeCli().catch(failStop1FigmaPixelProbe);
}
