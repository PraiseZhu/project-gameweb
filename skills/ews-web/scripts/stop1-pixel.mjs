#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bindEwsSectionPaintExports, createEwsPixelAdapter, EWS_PIXEL_SKIP_MAP } from './lib/ews-pixel-adapter.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROBE_REL = '../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-probe.mjs';

function pagedPixelStateFromDemo(demoDir) {
  const modelPath = join(demoDir, 'model.json');
  if (!existsSync(modelPath)) return [];
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const rows = [];
  for (const end of ['pc', 'mobile']) {
    for (const item of model.platforms?.[end]?.pagedSwitches || []) {
      const liveCardCount = (item.pages || []).reduce((sum, page) => sum + ((page.items || []).length), 0);
      const indCount = Number(item.indCount) || 0;
      const pageCapacity = Number(item.pageCapacity) || 0;
      rows.push({
        end,
        switchId: item.switchId,
        indCount,
        pageCapacity,
        liveCardCount,
        livePageCount: item.pageCount,
        pixelCardCount: liveCardCount,
        pixelPageCount: item.pageCount,
        page: 0,
        source: 'product-live',
      });
    }
  }
  return rows;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

export async function runStop1Pixel(argv = process.argv.slice(2), { cwd = process.cwd(), skillRoot = SKILL_ROOT } = {}) {
  const demoArg = arg(argv, '--demo');
  const handoffArg = arg(argv, '--handoff');
  const artifactsArg = arg(argv, '--artifacts');
  if (!demoArg || !handoffArg) {
    return { ok: false, gate: 'stop1-pixel', schema: 'stop1-figma-pixel-gate/v1', problems: ['缺少 --demo 或 --handoff'] };
  }
  const demoDir = isAbsolute(demoArg) ? demoArg : resolve(cwd, demoArg);
  const handoffDir = isAbsolute(handoffArg) ? handoffArg : resolve(cwd, handoffArg);
  const artifactsDir = artifactsArg
    ? (isAbsolute(artifactsArg) ? artifactsArg : resolve(cwd, artifactsArg))
    : join(demoDir, 'artifacts', 'stop1');
  const probePath = resolve(skillRoot, PROBE_REL);
  if (!existsSync(probePath)) {
    return { ok: false, gate: 'stop1-pixel', problems: [`缺少仓内像素探针：${PROBE_REL}（缺失不得 skip）`] };
  }
  const { runLiveStop1FigmaPixelProbe } = await import(pathToFileURL(probePath).href);
  const gatePath = resolve(skillRoot, '../../standards/stop1-figma-pixel/tool/src/stop1-figma-pixel-gate.mjs');
  if (!existsSync(gatePath)) {
    return { ok: false, gate: 'stop1-pixel', problems: ['缺少仓内像素闸门：stop1-figma-pixel-gate.mjs（缺失不得 skip）'] };
  }
  const { sectionPaintExports } = await import(pathToFileURL(gatePath).href);
  const started = Date.now();
  const log = (stage, extra = {}) => {
    process.stderr.write(`[stop1-pixel] ${stage} +${Date.now() - started}ms ${JSON.stringify(extra)}\n`);
  };
  log('probe-start', { demoDir, handoffDir, artifactsDir });
  try {
    const result = await runLiveStop1FigmaPixelProbe({
      demoDir,
      handoffDir,
      adapter: createEwsPixelAdapter({
        sectionPaintExports: bindEwsSectionPaintExports(sectionPaintExports),
      }),
      skipMap: EWS_PIXEL_SKIP_MAP,
    });
    mkdirSync(artifactsDir, { recursive: true });
    const payload = {
      ...result,
      gate: 'stop1-pixel',
      probeMs: Date.now() - started,
      pagedPixel: pagedPixelStateFromDemo(demoDir),
      pagedPixelNote: '像素截屏与产品页同一分页态（本期 8 卡 / 2 页 / 2 点），停在第 1 页。不对 ind 区域加遮罩。',
    };
    writeFileSync(join(artifactsDir, 'stop1-pixel.json'), `${JSON.stringify(payload, null, 2)}\n`);
    log('probe-done', { ok: payload.ok, problems: (payload.problems || []).length, probeMs: payload.probeMs });
    return payload;
  } catch (err) {
    const payload = {
      ok: false,
      gate: 'stop1-pixel',
      schema: 'stop1-figma-pixel-gate/v1',
      skipped: false,
      probeMs: Date.now() - started,
      problems: [err.message],
    };
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(join(artifactsDir, 'stop1-pixel.json'), `${JSON.stringify(payload, null, 2)}\n`);
    log('probe-throw', { probeMs: payload.probeMs, message: err.message });
    return payload;
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runStop1Pixel();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, gate: result.gate, schema: result.schema }, null, 2)}\n`);
}
