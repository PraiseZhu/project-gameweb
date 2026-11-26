// #164 诊断矩阵 producer 闭环：混合 Noto/Bebas 两种字体、两种逐卡回答顺序、
// 重答、no/partial/full 配置、坏 shape 保留。先用同 fixture 验证负例（旧行为
// 无命中造空 face / 顺序依赖 / 坏 shape 被覆盖），再断言修复后语义。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement as runBSupplementRaw } from '../src/b-supplement.mjs';
import { runBAnswer as runBAnswerRaw } from '../src/b-answer.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { canonicalJson } from '../src/canonical.mjs';
import { autoReuseFonts } from '../src/fonts-b2.mjs';

const ISOLATED_FONT_DISCOVERY = Object.freeze({ directories: [] });
const runBSupplement = (options = {}) => runBSupplementRaw({ fontDiscovery: ISOLATED_FONT_DISCOVERY, ...options });
const runBAnswer = (options = {}) => runBAnswerRaw({ fontDiscovery: ISOLATED_FONT_DISCOVERY, ...options });

const WT = resolve(import.meta.dirname, '../../..');
const NOTO_BYTES = readFileSync(join(WT, 'skills/torchlight-web/fonts/NotoSansSC-VF.ttf'));
const BEBAS_BYTES = readFileSync(join(WT, 'skills/yise-web-ui/fonts/BebasNeue-Regular.woff2'));
const NOTO_DIGEST = `sha256:${createHash('sha256').update(NOTO_BYTES).digest('hex')}`;
const BEBAS_DIGEST = `sha256:${createHash('sha256').update(BEBAS_BYTES).digest('hex')}`;

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
  tmp = mkdtempSync(join(tmpdir(), 'onepage-fontreuse-'));
});
afterEach(() => {
  if (previousToken === undefined) delete process.env.FIGMA_ACCESS_TOKEN;
  else process.env.FIGMA_ACCESS_TOKEN = previousToken;
  rmSync(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, json: async () => body };
}
function box(x, y, w, h) { return { x, y, width: w, height: h }; }
function text(id, name, characters, fontFamily, fontWeight) {
  return {
    id, name, type: 'TEXT', characters,
    absoluteBoundingBox: box(0, 0, 80, 20),
    style: { fontFamily, fontWeight },
  };
}
function frame(id, name, children = []) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: box(0, 0, 400, 300), children };
}
// 混合两种真实字体：Noto Sans SC 100 + Bebas Neue 400，都是存在字库
function mixedPc() {
  return frame('10:1', 'cn_pc', [
    frame('10:2', 'sec/1-首页', [
      text('t-n', '标题', '标题', 'Noto Sans SC', 100),
      text('t-b', '卖点', 'ABC', 'Bebas Neue', 400),
    ]),
  ]);
}
function canvasBody(children) {
  return { version: VERSION, nodes: { [CANVAS_ID]: { document: { id: CANVAS_ID, name: '规范页', type: 'CANVAS', children } } } };
}
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

async function confirmA(body) {
  const fetchImpl = async () => jsonRes(200, body);
  const first = await runAScope({
    url: PAGE_URL, languages: 'cn', baseLanguage: 'cn', platform: 'pc',
    runRoot: tmp, tokenValue: STUB, fetchImpl,
  });
  assert.equal(first.ok, true, first.message);
  return runAScope({
    url: PAGE_URL, languages: 'cn', baseLanguage: 'cn', platform: 'pc',
    runRoot: tmp, tokenValue: STUB, fetchImpl,
    shownFp: first.fingerprintPrefix, confirmQuote: '确认，按这个范围做',
    confirmSource: 'cindy-card', runDir: first.runDir,
  });
}

function projectDir() {
  const dir = join(tmp, 'projects', `${FILE_ID.slice(0, 8)}-1-2`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(WT, 'skills/torchlight-web/fonts/NotoSansSC-VF.ttf'), join(dir, 'noto.ttf'));
  copyFileSync(join(WT, 'skills/yise-web-ui/fonts/BebasNeue-Regular.woff2'), join(dir, 'bebas.woff2'));
  return dir;
}

const NOTO_SPEC = {
  resourceId: 'noto', file: 'noto.ttf', weights: [100], format: 'ttf',
  source: 'test-foundry', license: 'OFL', digest: NOTO_DIGEST,
  licenseReview: { status: 'confirmed', evidence: 'OFL 仓库内授权文本' },
};
const BEBAS_SPEC = {
  resourceId: 'bebas', file: 'bebas.woff2', weights: [400], format: 'woff2',
  source: 'test-foundry', license: 'OFL', digest: BEBAS_DIGEST,
  licenseReview: { status: 'confirmed', evidence: 'OFL 仓库内授权文本' },
};

function fontValue(card, order) {
  if (card.type !== 'font-map') return null;
  const key = card.object || card.faceKey || card.key || '';
  const spec = /Noto/.test(key) ? NOTO_SPEC : /Bebas/.test(key) ? BEBAS_SPEC : null;
  if (!spec) return null;
  const mappings = {};
  for (const lang of card.langs) mappings[lang] = { ...spec };
  return { mappings };
}

async function answerLoop(confirmed, order) {
  let run = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  let rounds = 0;
  const seen = [];
  while (run.result === 'needs-input' && rounds < 24) {
    rounds += 1;
    const questions = readJson(run.questionsPath);
    const fontCards = questions.filter((q) => q.type === 'font-map');
    const others = questions.filter((q) => q.type !== 'font-map');
    // order 控制先答 Noto 还是 Bebas
    const noto = fontCards.find((q) => /Noto/.test(q.object || ''));
    const bebas = fontCards.find((q) => /Bebas/.test(q.object || ''));
    const pick = order === 'noto-first' ? [noto, bebas] : [bebas, noto];
    let card = pick.find(Boolean) || null;
    let value = card ? fontValue(card, order) : null;
    if (!value) {
      card = others[0] || null;
      if (!card) return { run, rounds, seen };
      value = { choice: 'design-default' };
      if (card.type === 'data-static-or-dynamic') value = { choice: 'static' };
      if (card.type === 'button-action') value = { choice: 'next-section' };
    }
    seen.push(card.type + ':' + (card.object || ''));
    run = await runBAnswer({
      runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB,
      now: '2026-11-25T00:00:00.000Z',
      answersValue: { answers: [{ id: card.id, fingerprint: card.fingerprint, value }] },
    });
  }
  return { run, rounds, seen };
}

for (const order of ['noto-first', 'bebas-first']) {
  test(`混合字体逐卡回答（${order}）：未答 needs-input，答完 pass 且 checkEntry 稳定`, async () => {
    const body = canvasBody([mixedPc()]);
    const confirmed = await confirmA(body);
    const b1 = await runBExtract({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, fetchImpl: async () => jsonRes(200, body) });
    assert.equal(b1.ok, true, b1.message);
    projectDir(); // 只放字体文件，不预置 fonts 配置 → 全靠逐卡回答

    const first = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
    assert.equal(first.result, 'needs-input');
    const q0 = readJson(first.questionsPath);
    assert.equal(q0.filter((q) => q.type === 'font-map').length, 2, `应出两张 font-map：${JSON.stringify(q0.map((q) => q.type))}`);

    const { run, seen } = await answerLoop(confirmed, order);
    if (run.result !== 'pass') {
      const problems = readJson(run.problemsPath).slice(0, 10);
      assert.fail(`${order} 未 pass：${JSON.stringify(problems.map((p) => `${p.code}:${p.missing || ''}`))}`);
    }
    assert.equal(run.result, 'pass');
    assert.ok(seen.some((row) => row.includes('Noto')) && seen.some((row) => row.includes('Bebas')), `两字体都应被逐卡答过：${JSON.stringify(seen)}`);

    const supplement = readJson(run.supplementPath);
    for (let i = 0; i < 3; i += 1) {
      const gate = checkEntry(run.stagePath, {
        expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: supplement.version,
      });
      assert.equal(gate.ok, true, gate.reason);
    }
  });
}

test('autoReuseFonts 三态（direct helper）：无命中/歧义不造 face，坏 shape 保留', () => {
  const inv = { nodes: [
    { id: 't1', name: 'copy/文', type: 'TEXT', status: 'determined', role: 'copy', parentId: null, text: { characters: 'A', fontFamily: 'Noto Sans SC', fontWeight: 100 } },
  ] };
  const dir = projectDir();
  // 无命中：resources 空 → 不造 face
  const noHit = autoReuseFonts({ faces: {}, resources: {} }, { pc: inv }, dir, ['cn'], 'cn');
  assert.deepEqual(noHit.faces, {}, '无命中不得造空 face');
  // 唯一命中：补 cn
  const hit = autoReuseFonts({
    faces: {}, resources: { noto: { file: 'noto.ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL' } },
  }, { pc: inv }, dir, ['cn'], 'cn');
  assert.equal(hit.faces['Noto Sans SC/100']?.cn, 'noto', '唯一命中应填缺语言');
  // 歧义命中（两个相同资源）→ 不填
  const ambiguous = autoReuseFonts({
    faces: {}, resources: {
      noto1: { file: 'noto.ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL' },
      noto2: { file: 'noto.ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL' },
    },
  }, { pc: inv }, dir, ['cn'], 'cn');
  assert.deepEqual(ambiguous.faces, {}, '歧义命中不得填映射');
  // 坏 shape：字符串 face 保留原样
  const badShape = autoReuseFonts({
    faces: { 'Noto Sans SC/100': 'noto' },
    resources: { noto: { file: 'noto.ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL' } },
  }, { pc: inv }, dir, ['cn'], 'cn');
  assert.equal(badShape.faces['Noto Sans SC/100'], 'noto', '坏 shape 不得被覆盖');
  // 坏顶层容器保留
  const badTop = autoReuseFonts({ faces: 'broken', resources: {} }, { pc: inv }, dir, ['cn'], 'cn');
  assert.equal(badTop.faces, 'broken');
  // 部分合法映射保留
  const partial = autoReuseFonts({
    faces: { 'Noto Sans SC/100': { en: 'manual' } },
    resources: { noto: { file: 'noto.ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL' } },
  }, { pc: inv }, dir, ['cn'], 'cn');
  assert.equal(partial.faces['Noto Sans SC/100'].en, 'manual', '已有合法语言保留');
  assert.equal(partial.faces['Noto Sans SC/100'].cn, 'noto', '缺的 cn 自动补');
});

test('坏 shape 走 producer 不被自动修复：compile FONT_CONFIG', async () => {
  const body = canvasBody([mixedPc()]);
  const confirmed = await confirmA(body);
  const b1 = await runBExtract({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, fetchImpl: async () => jsonRes(200, body) });
  assert.equal(b1.ok, true, b1.message);
  const dir = projectDir();
  writeFileSync(join(dir, 'config.json'), `${canonicalJson({
    fonts: {
      faces: { 'Noto Sans SC/100': 'noto' }, // 坏 shape：字符串不是对象
      resources: { noto: { file: 'noto.ttf', weights: [100], format: 'ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL', licenseReview: { status: 'confirmed', evidence: 'x' } } },
    },
  })}\n`);
  const run = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  const problems = readJson(run.problemsPath);
  assert.equal(run.result, 'needs-input');
  assert.ok(problems.some((row) => row.code === 'FONT_CONFIG'), `坏 shape 必须 FONT_CONFIG 拒：${JSON.stringify(problems.map((p) => p.code).slice(0, 10))}`);
  // 坏 shape 没被改成对象
  const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  assert.equal(written.fonts.faces['Noto Sans SC/100'], 'noto', '坏 shape 不得被自动覆盖');
});

test('空 faces 唯一命中：B2 首次补全即通过，不保留旧 FONT_CONFIG', async () => {
  const body = canvasBody([frame('10:1', 'cn_pc', [
    frame('10:2', 'sec/1-首页', [text('t-n', '标题', '标题', 'Noto Sans SC', 100)]),
  ])]);
  const confirmed = await confirmA(body);
  const options = { runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB };
  const extracted = await runBExtract({ ...options, fetchImpl: async () => jsonRes(200, body) });
  assert.equal(extracted.ok, true, extracted.message);
  const configPath = join(projectDir(), 'config.json');
  const { resourceId, ...resource } = NOTO_SPEC;
  writeFileSync(configPath, canonicalJson({ fonts: { faces: {}, resources: { [resourceId]: resource } } }));
  const run = await runBSupplement(options);
  const problems = readJson(run.problemsPath);
  assert.equal(run.result, 'pass', JSON.stringify(problems));
  assert.ok(!problems.some((row) => row.code === 'FONT_CONFIG'));
  assert.equal(readJson(configPath).fonts.faces['Noto Sans SC/100'].cn, resourceId);
});

test('预置全齐合法配置：producer 直接 pass（无命中 face 不被重建）', async () => {
  const body = canvasBody([mixedPc()]);
  const confirmed = await confirmA(body);
  const b1 = await runBExtract({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB, fetchImpl: async () => jsonRes(200, body) });
  assert.equal(b1.ok, true, b1.message);
  const dir = projectDir();
  writeFileSync(join(dir, 'config.json'), `${canonicalJson({
    fonts: {
      faces: {
        'Noto Sans SC/100': { cn: 'noto' },
        'Bebas Neue/400': { cn: 'bebas' },
      },
      resources: {
        noto: { file: 'noto.ttf', weights: [100], format: 'ttf', digest: NOTO_DIGEST, source: 't', license: 'OFL', licenseReview: { status: 'confirmed', evidence: 'x' } },
        bebas: { file: 'bebas.woff2', weights: [400], format: 'woff2', digest: BEBAS_DIGEST, source: 't', license: 'OFL', licenseReview: { status: 'confirmed', evidence: 'x' } },
      },
    },
  })}\n`);
  const run = await runBSupplement({ runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB });
  assert.equal(run.result, 'pass', JSON.stringify(readJson(run.problemsPath).slice(0, 6).map((p) => `${p.code}:${p.missing||p.message||''}`)));
});

for (const [description, mapping] of [['face', null], ['语言键', { cn: null }]]) {
  test(`显式 null ${description}：连续两轮 B2 保留原配置并阻断`, async () => {
    const body = canvasBody([mixedPc()]);
    const confirmed = await confirmA(body);
    const options = { runRoot: tmp, runDir: confirmed.runDir, tokenValue: STUB };
    const extracted = await runBExtract({ ...options, fetchImpl: async () => jsonRes(200, body) });
    assert.equal(extracted.ok, true, extracted.message);
    const configPath = join(projectDir(), 'config.json');
    const { resourceId: notoId, ...noto } = NOTO_SPEC;
    const { resourceId: bebasId, ...bebas } = BEBAS_SPEC;
    const config = {
      fonts: {
        faces: { 'Noto Sans SC/100': { cn: notoId }, 'Bebas Neue/400': { cn: bebasId } },
        resources: { [notoId]: noto, [bebasId]: bebas },
      },
    };
    writeFileSync(configPath, canonicalJson(config) + '\n');
    const baseline = await runBSupplement(options);
    assert.equal(baseline.result, 'pass');
    const check = (run) => checkEntry(run.stagePath, {
      expectedStage: 'B', expectedOutputKind: 'b-supplement',
      expectedOutputVersion: readJson(run.supplementPath).version,
    }).ok;
    assert.equal(check(baseline), true);
    config.fonts.faces['Noto Sans SC/100'] = mapping;
    const expected = canonicalJson(config) + '\n';
    writeFileSync(configPath, expected);
    const results = [];
    for (const round of [1, 2]) {
      const run = await runBSupplement(options);
      const errors = readJson(run.problemsPath).filter((row) => row.code === 'FONT_CONFIG');
      results.push({
        round, pass: run.result === 'pass', blocked: errors.some((row) => row.returnTo === '工具'),
        mapping: readJson(configPath).fonts.faces['Noto Sans SC/100'], entry: check(run),
      });
    }
    assert.deepEqual(results, [1, 2].map((round) => ({ round, pass: false, blocked: true, mapping, entry: false })));
  });
}
