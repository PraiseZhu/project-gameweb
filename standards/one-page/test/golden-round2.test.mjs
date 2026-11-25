// #164 round2 黄金全链回归：数据丰富稿走真实 producer 全链
// A → B1 → supplement/answer 循环 → result=pass → checkEntry 稳定通过。
// 上一轮半修复在此链第二轮（checkEntry 复算）会产生 MOTION_OVERLAP/COMPOSITION。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runBAnswer } from '../src/b-answer.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { canonicalJson } from '../src/canonical.mjs';

const CANVAS_ID = '1:2';
const FILE_ID = 'TESTFILEKEY';
const PAGE_URL = `https://www.figma.com/design/${FILE_ID}/name?node-id=1-2`;
const STUB = ['no', 'leak'].join('-');
const VERSION = '4242';

let tmp;
let previousToken;

beforeEach(() => {
  previousToken = process.env.FIGMA_ACCESS_TOKEN;
  process.env.FIGMA_ACCESS_TOKEN = STUB;
  tmp = mkdtempSync(join(tmpdir(), 'onepage-golden2-'));
});
afterEach(() => {
  if (previousToken === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
  else process.env.FIGMA_ACCESS_TOKEN = previousToken;
  rmSync(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, json: async () => body };
}
function box(x, y, w, h) {
  return { x, y, width: w, height: h };
}
function frame(id, name, children = [], extra = {}) {
  const { absoluteBoundingBox, ...rest } = extra;
  return { id, name, type: 'FRAME', absoluteBoundingBox: absoluteBoundingBox || box(0, 0, 400, 300), children, ...rest };
}
function text(id, name, characters, extra = {}) {
  return {
    id, name, type: 'TEXT', characters,
    absoluteBoundingBox: box(0, 0, 80, 20),
    style: { fontFamily: extra.fontFamily || 'FakeSans', fontWeight: extra.fontWeight || 400 },
    ...extra,
  };
}
function u16(n) { return Buffer.from([(n >> 8) & 0xff, n & 0xff]); }
function u32(n) { return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]); }

function maxpTable(numGlyphs = 2048) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(numGlyphs, 4);
  return buf;
}
function buildTinyTtf(chars) {
  const codes = [...chars].map((ch) => ch.codePointAt(0)).sort((a, b) => a - b);
  const segs = codes.map((cp) => ({ start: cp, end: cp }));
  segs.push({ start: 0xffff, end: 0xffff });
  const segCount = segs.length;
  const body = Buffer.concat([
    u16(4), u16(16 + segCount * 8), u16(0),
    u16(segCount * 2), u16(2), u16(0), u16(segCount * 2 - 2),
    Buffer.concat(segs.map((s) => u16(s.end))), u16(0),
    Buffer.concat(segs.map((s) => u16(s.start))),
    // delta 按段计算：(cp + delta) % 0x10000 落在 1..N（有效字形索引），0xffff 哨兵段任意
    Buffer.concat(segs.map((s) => u16(s.start === 0xffff ? 1 : (0x10000 + 1 - s.start) % 0x10000))),
    Buffer.alloc(segCount * 2),
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), body]);
  // 带 name/OS2 让身份核验过：family 需匹配 FakeSans
  const fam = Buffer.from('FakeSans', 'latin1');
  const nameRec = Buffer.concat([u16(1), u16(0), u16(0), u16(1), u16(fam.length), u16(0)]);
  const nameTable = Buffer.concat([u16(0), u16(1), u16(6 + 12), nameRec, fam]);
  const os2 = Buffer.concat([u16(0), u16(0), u16(400), Buffer.alloc(60)]);
  const maxp = maxpTable();
  const header = Buffer.concat([u32(0x00010000), u16(4), u16(64), u16(0), u16(0)]);
  const recs = Buffer.concat([
    Buffer.from('cmap'), u32(0), u32(12 + 16 * 4), u32(cmap.length),
    Buffer.from('name'), u32(0), u32(12 + 16 * 4 + cmap.length), u32(nameTable.length),
    Buffer.from('OS/2'), u32(0), u32(12 + 16 * 4 + cmap.length + nameTable.length), u32(os2.length),
    Buffer.from('maxp'), u32(0), u32(12 + 16 * 4 + cmap.length + nameTable.length + os2.length), u32(maxp.length),
  ]);
  return Buffer.concat([header, recs, cmap, nameTable, os2, maxp]);
}

/** 数据丰富双端稿：title/list+item+@field/switch 轮播/slots/btn/多 sec。 */
function richPc() {
  const item = frame('30:2', 'item/条目@template', [
    text('30:3', '名称@field=name', '金币'),
    frame('30:4', 'img/图标@field=image'),
  ]);
  const list = frame('30:1', 'list/奖励列表@data=list:rewards', [item], { layoutMode: 'VERTICAL' });
  const slots = frame('40:1', 'list/导航槽@data=slots:navs', [
    frame('40:2', 'item/首槽', [text('40:3', '文字@field=label', '首页')]),
    frame('40:4', 'item/次槽', [text('40:5', '文字@field=label', '商城')]),
  ]);
  return frame('10:1', 'cn_pc', [
    frame('10:2', 'sec/1-首页', [
      frame('10:3', 'title/标题'),
      frame('50:1', 'switch/轮播', [list]),
      frame('10:4', 'btn/下一屏@sec=next'),
    ], { absoluteBoundingBox: box(0, 0, 1920, 1080) }),
    frame('10:8', 'sec/2-导航', [slots], { absoluteBoundingBox: box(0, 1080, 1920, 1080) }),
  ], { absoluteBoundingBox: box(0, 0, 1920, 2160) });
}
function richMobile() {
  const item = frame('60:2', 'item/条目@template', [
    text('60:3', '名称@field=name', '金币'),
    frame('60:4', 'img/图标@field=image'),
  ]);
  const list = frame('60:1', 'list/奖励列表@data=list:rewards', [item], { layoutMode: 'VERTICAL' });
  const slots = frame('70:1', 'list/导航槽@data=slots:navs', [
    frame('70:2', 'item/首槽', [text('70:3', '文字@field=label', '首页')]),
    frame('70:4', 'item/次槽', [text('70:5', '文字@field=label', '商城')]),
  ]);
  return frame('20:1', 'cn_mobile', [
    frame('20:2', 'sec/1-首页', [
      frame('20:3', 'title/标题'),
      frame('80:1', 'switch/轮播', [list]),
      frame('20:4', 'btn/下一屏@sec=next'),
    ], { absoluteBoundingBox: box(0, 2000, 390, 844) }),
    frame('20:8', 'sec/2-导航', [slots], { absoluteBoundingBox: box(0, 2844, 390, 844) }),
  ], { absoluteBoundingBox: box(0, 2000, 390, 1688) });
}
function canvasBody(children, version = VERSION, nodeId = CANVAS_ID) {
  return { version, nodes: { [nodeId]: { document: { id: nodeId, name: '规范页', type: 'CANVAS', children } } } };
}
function fetchOf(body) {
  return async () => jsonRes(200, body);
}
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

async function confirmA({ body, platform = 'pc+mobile', languages = 'cn' } = {}) {
  const fetchImpl = fetchOf(body);
  const first = await runAScope({
    url: PAGE_URL, languages, baseLanguage: 'cn', platform,
    runRoot: tmp, tokenValue: STUB, fetchImpl,
  });
  assert.equal(first.ok, true, first.message);
  const confirmed = await runAScope({
    url: PAGE_URL, languages, baseLanguage: 'cn', platform,
    runRoot: tmp, tokenValue: STUB, fetchImpl,
    shownFp: first.fingerprintPrefix, confirmQuote: '确认，按这个范围做',
    confirmSource: 'cindy-card', runDir: first.runDir,
  });
  assert.equal(confirmed.ok, true, confirmed.message);
  return { ...confirmed, fetchImpl, body };
}

function answerValueFor(card, fontSpec) {
  if (card.type === 'font-map') {
    const mappings = {};
    for (const lang of card.langs) mappings[lang] = { ...fontSpec };
    return { mappings };
  }
  if (card.type === 'data-contract-exception') return { choice: 'design-default' };
  if (card.type === 'data-static-or-dynamic') return { choice: 'static' };
  if (card.type === 'carousel') return null; // 已在稿上声明分页，不应出现
  if (card.type === 'button-action') return { choice: 'next-section' };
  return null;
}

test('黄金全链：数据丰富双端稿 pass 且 checkEntry 三次复查稳定', async () => {
  const body = canvasBody([richPc(), richMobile()]);
  const confirmed = await confirmA({ body });
  const b1 = await runBExtract({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, fetchImpl: confirmed.fetchImpl });
  assert.equal(b1.ok, true, b1.message);

  // 预置字体文件与分页/槽位配置（真实 producer 路径：config.json 在项目目录）
  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  const ttf = buildTinyTtf('金币首页商城标题字下一屏');
  const digest = `sha256:${createHash('sha256').update(ttf).digest('hex')}`;
  writeFileSync(join(configDir, 'fake.ttf'), ttf);
  writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
    bindings: {
      'sec/1::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励列表', perPage: 2 } },
      'sec/2::list/导航槽': {
        slotMapping: { kind: 'key', field: 'id', keys: ['home', 'shop'] },
        missing: 'design-default',
      },
    },
  })}\n`);
  const fontSpec = {
    resourceId: 'fake',
    file: 'fake.ttf', weights: [400], format: 'ttf',
    source: 'test-foundry', license: 'OFL', digest,
  };

  // supplement → answer 循环直到 pass（真实 producer 同一条链）
  let run = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  let rounds = 0;
  while (run.result === 'needs-input' && rounds < 24) {
    rounds += 1;
    const questions = readJson(run.questionsPath);
    // 一次只答一张卡：每答一张配置变化会重算后续卡指纹，批量答会 answer-stale
    let answers = null;
    for (const card of questions) {
      const value = answerValueFor(card, fontSpec);
      if (value) { answers = [{ id: card.id, fingerprint: card.fingerprint, value }]; break; }
    }
    console.error('round',rounds,'cards',questions.map(q=>[q.id,q.type,q.fingerprint?.slice(0,8),JSON.stringify(q.locations?.[0]||{}).slice(0,80)]));
    assert.ok(answers, `第 ${rounds} 轮没有可答卡片：${JSON.stringify(questions.map((q) => q.type))}`);
    run = await runBAnswer({
      runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB,
      now: '2026-11-25T00:00:00.000Z', answersValue: { answers },
    });
  }
  if (run.result !== 'pass') {
    const detail = {};
    for (const key of ['problemsPath', 'questionsPath', 'message', 'code']) {
      if (run[key] && key.endsWith('Path')) detail[key] = readJson(run[key]).slice(0, 8);
      else detail[key] = run[key];
    }
    assert.fail(`未 pass：${JSON.stringify(detail)}`);
  }
  assert.equal(readJson(run.questionsPath).length, 0);

  // checkEntry 三次复查：语义与结果必须一致（上一轮会出 MOTION_OVERLAP/COMPOSITION）
  const supplement = readJson(run.supplementPath);
  const gates = [];
  for (let i = 0; i < 3; i += 1) {
    const gate = checkEntry(run.stagePath, {
      expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: supplement.version,
    });
    gates.push({ ok: gate.ok, reason: gate.reason || null });
  }
  assert.deepEqual(gates, [{ ok: true, reason: null }, { ok: true, reason: null }, { ok: true, reason: null }]);

  // 产物完整：font-audit/data-contract/data-samples/data-check 存在且 data-check pass
  const artifacts = supplement.artifacts || supplement;
  for (const key of ['fontAudit', 'dataContract', 'sampleIndex', 'dataCheck']) {
    assert.ok(artifacts[key]?.path || artifacts[key], `缺产物 ${key}`);
  }
});

test('黄金全链：pending licenseReview 走 producer 链仍阻断不冒充 pass', async () => {
  const body = canvasBody([richPc(), richMobile()]);
  const confirmed = await confirmA({ body });
  const b1 = await runBExtract({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, fetchImpl: confirmed.fetchImpl });
  assert.equal(b1.ok, true, b1.message);
  const configDir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(configDir, { recursive: true });
  const ttf = buildTinyTtf('金币首页商城标题字下一屏');
  const digest = `sha256:${createHash('sha256').update(ttf).digest('hex')}`;
  writeFileSync(join(configDir, 'fake.ttf'), ttf);
  writeFileSync(join(configDir, 'config.json'), `${canonicalJson({
    bindings: {
      'sec/1::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励列表', perPage: 2 } },
      'sec/2::list/导航槽': {
        slotMapping: { kind: 'key', field: 'id', keys: ['home', 'shop'] },
        missing: 'design-default',
      },
    },
    fonts: {
      faces: { 'FakeSans/400': { cn: 'fake' } },
      resources: {
        fake: {
          file: 'fake.ttf', weights: [400], format: 'ttf',
          source: 'test-foundry', license: 'OFL', digest,
          licenseReview: { status: 'pending', note: 'npm 包未随附正式 license 文本，再分发须人工确认' },
        },
      },
    },
  })}\n`);
  const run = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const problems = readJson(run.problemsPath);
  assert.equal(run.result, 'needs-input');
  assert.equal(problems.some((row) => row.code === 'FONT_SOURCE'), true, JSON.stringify(problems.map((p) => p.code)));
  // compile 层不再把合法 pending 当未知字段
  assert.equal(problems.some((row) => row.code === 'FONT_CONFIG'), false);
});
