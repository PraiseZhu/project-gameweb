/**
 * Re-export the shared stop-1 Figma pixel gate.
 * Callers: figma-html-from-handoff.mjs attachStop1FigmaPixelGate;
 *   stop1-figma-pixel-probe.mjs; scripts/__tests__/stop1-figma-pixel-gate.test.mjs.
 * Schema: stop1-figma-pixel-gate/v1. Source: standards/stop1-figma-pixel/tool/src.
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
export * from '../../../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-gate.mjs';
