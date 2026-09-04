/**
 * torchlightweb 总编排：固定状态机，一次只推一相。
 * 机器只写 presented / probed。accepted 只能来自独立 accept 命令。
 * 禁止 showcase、跳过人核、私自加减步骤。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { inspectPackPath, packRoot } from './pack-demo.mjs';
import {
  acceptStop,
  canStartLaterAxis,
  packAllowedAfterSecondStop,
  presentStop,
  readHumanReview,
} from './human-review.mjs';
import { translationAxisClaim } from './translation/locale-policy.mjs';
import { laterAxesProbeRecordIsGreen, readLaterAxesProbe } from './later-axes-probe.mjs';

export const TORCHLIGHTWEB_MACHINE_SCHEMA = 'torchlightweb-machine/v1';
export const TORCHLIGHTWEB_MACHINE_FILE = 'torchlightweb-machine.json';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MACHINE_STATE_DIR = join(REPO_ROOT, '_tmp', 'torchlightweb-machine');
export const TORCHLIGHTWEB_PHASES = Object.freeze([
  'need-ready-pack',
  'main-static',
  'wait-stop-1',
  'later-axes',
  'wait-stop-2',
  'pack',
  'done',
]);
export const FORBIDDEN_TORCHLIGHTWEB_FLAGS = Object.freeze([
  '--showcase',
  '--workflow',
  '--skip-preview',
  '--allow-green-draft',
  '--from-orchestrator',
  '--url',
]);

const STOP_1 = 'static-and-translation';
const STOP_2 = 'interaction-and-resize';
const COMMANDS = Object.freeze(['start', 'continue', 'status', 'accept']);

export function torchlightwebMachinePath(demoDir) {
  const key = createHash('sha256').update(packRoot(demoDir)).digest('hex').slice(0, 16);
  return join(MACHINE_STATE_DIR, `${key}-${TORCHLIGHTWEB_MACHINE_FILE}`);
}

function inspectMachineFile(demoDir) {
  const file = torchlightwebMachinePath(demoDir);
  if (!existsSync(file)) return { ok: false, path: file, error: `missing path: ${file}` };
  return { ok: true, path: file };
}

function emptyMachine(demoDir, handoffDir = null) {
  return {
    schema: TORCHLIGHTWEB_MACHINE_SCHEMA,
    phase: handoffDir ? 'main-static' : 'need-ready-pack',
    demoDir: packRoot(demoDir),
    handoffDir: handoffDir ? resolve(handoffDir) : null,
    fingerprint: null,
    history: [],
    translation: null,
    laterAxes: null,
    forbidden: ['figma-showcase', 'skip-human-review', 'extra-steps'],
  };
}

export function readTorchlightwebMachine(demoDir) {
  const inspected = inspectMachineFile(demoDir);
  const file = inspected.path || torchlightwebMachinePath(demoDir);
  if (!inspected.ok) {
    return { ...emptyMachine(demoDir), missing: true, file, inspectError: inspected.error };
  }
  try {
    const parsed = JSON.parse(readFileSync(inspected.path, 'utf8'));
    if (!parsed || parsed.schema !== TORCHLIGHTWEB_MACHINE_SCHEMA) {
      return { ...emptyMachine(demoDir), missing: true, invalid: true, file };
    }
    if (!TORCHLIGHTWEB_PHASES.includes(parsed.phase)) {
      return { ...emptyMachine(demoDir), missing: true, invalid: true, file };
    }
    return {
      ...emptyMachine(demoDir, parsed.handoffDir),
      ...parsed,
      missing: false,
      invalid: false,
      file,
    };
  } catch {
    return { ...emptyMachine(demoDir), missing: true, invalid: true, file };
  }
}

function writeMachine(demoDir, record) {
  const inspected = inspectMachineFile(demoDir);
  const file = torchlightwebMachinePath(demoDir);
  if (inspected.ok === false && inspected.error && !/missing path/.test(inspected.error)) {
    throw new Error(inspected.error);
  }
  mkdirSync(dirname(file), { recursive: true });
  const payload = {
    schema: TORCHLIGHTWEB_MACHINE_SCHEMA,
    phase: record.phase,
    demoDir: packRoot(demoDir),
    handoffDir: record.handoffDir || null,
    fingerprint: record.fingerprint || null,
    history: Array.isArray(record.history) ? record.history : [],
    translation: record.translation || null,
    laterAxes: record.laterAxes || null,
    forbidden: ['figma-showcase', 'skip-human-review', 'extra-steps'],
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  const written = inspectMachineFile(demoDir);
  if (!written.ok) throw new Error(written.error || 'torchlightweb-machine.json is not a regular file inside the demo');
  return written.path;
}

function stamp(record, phase, at) {
  record.phase = phase;
  record.history = [...(record.history || []), { phase, at }];
  return record;
}

export function forbiddenTorchlightwebFlag(argv = []) {
  return argv.find((arg) => FORBIDDEN_TORCHLIGHTWEB_FLAGS.includes(arg)) || null;
}

export function parseTorchlightwebArgs(argv = []) {
  const forbidden = forbiddenTorchlightwebFlag(argv);
  if (forbidden) {
    return {
      ok: false,
      error: `forbidden-flag:${forbidden}`,
      nextHumanStep: 'torchlightweb 只走固定状态机。禁止 showcase / skip-preview / 私自加旗。',
    };
  }
  const command = argv[0] && !String(argv[0]).startsWith('--') ? argv[0] : 'start';
  const rest = argv[0] && !String(argv[0]).startsWith('--') ? argv.slice(1) : argv;
  const known = new Set(['--handoff', '--demo']);
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!String(key).startsWith('--')) {
      return { ok: false, error: `unknown-arg:${key}`, nextHumanStep: '只接受 start|continue|status|accept 与 --handoff / --demo。' };
    }
    if (!known.has(key)) {
      return { ok: false, error: `unknown-flag:${key}`, nextHumanStep: '只接受 --handoff 与 --demo。禁止加减步骤。' };
    }
    i += 1;
    if (rest[i] == null || String(rest[i]).startsWith('--')) {
      return { ok: false, error: `missing-value:${key}` };
    }
  }
  if (!COMMANDS.includes(command)) {
    return { ok: false, error: `unknown-command:${command}`, nextHumanStep: '只接受 start（默认）、continue、accept、status。' };
  }
  const demo = argOf(rest, '--demo');
  const handoff = argOf(rest, '--handoff');
  if (!demo) return { ok: false, error: 'missing-demo', nextHumanStep: '必须给 --demo <dir>。' };
  if (command !== 'start' && handoff) {
    return { ok: false, error: 'handoff-only-on-start', nextHumanStep: 'accept / continue / status 只接受 --demo。禁止换包或加步骤。' };
  }
  return { ok: true, command, demoDir: resolve(demo), handoffDir: handoff ? resolve(handoff) : null };
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function loadDemoSpecTruth(demoDir) {
  const specPath = join(packRoot(demoDir), 'spec.json');
  const truthPath = join(packRoot(demoDir), 'truth.json');
  let spec = {};
  let truth = {};
  try { spec = JSON.parse(readFileSync(specPath, 'utf8')); } catch {}
  try { truth = JSON.parse(readFileSync(truthPath, 'utf8')); } catch {}
  return { spec, truth };
}

function translationOf(demoDir) {
  const { spec, truth } = loadDemoSpecTruth(demoDir);
  return translationAxisClaim({ spec, truth });
}

function currentStop(phase) {
  if (phase === 'wait-stop-1') return STOP_1;
  if (phase === 'wait-stop-2') return STOP_2;
  return null;
}

function productViewForDemo(demoDir) {
  const indexPath = join(packRoot(demoDir), 'index.html');
  if (!existsSync(indexPath)) return { url: null, command: null, blocked: true };
  const url = `file://${indexPath}?product=1`;
  return { url, command: `open "${url}"` };
}

function payload(ok, record, extra = {}) {
  return {
    ok,
    schema: TORCHLIGHTWEB_MACHINE_SCHEMA,
    phase: record.phase,
    demoDir: record.demoDir,
    handoffDir: record.handoffDir,
    fingerprint: record.fingerprint,
    translation: record.translation,
    laterAxes: record.laterAxes,
    waiting: record.phase === 'wait-stop-1' || record.phase === 'wait-stop-2',
    ...extra,
  };
}

export async function runTorchlightweb(options) {
  const {
    command,
    demoDir,
    handoffDir = null,
    now = new Date().toISOString(),
    buildMain,
    packDemo,
    probeLaterAxes,
  } = options;
  const root = packRoot(demoDir);
  mkdirSync(root, { recursive: true });
  let record = readTorchlightwebMachine(root);
  if (record.missing) record = emptyMachine(root, record.handoffDir);

  if (command === 'status') {
    return payload(true, record, {
      humanReview: readHumanReview(root),
      laterAxesProbe: readLaterAxesProbe(root),
      nextHumanStep: nextStep(record),
    });
  }
  if (command === 'start') return startMachine({ record, root, handoffDir, now, buildMain });
  if (command === 'accept') return acceptMachine({ record, root, now });
  if (command === 'continue') return await continueMachine({ record, root, now, packDemo, probeLaterAxes });
  return payload(false, record, { error: `unknown-command:${command}` });
}

function nextStep(record) {
  if (record.phase === 'need-ready-pack') return '停下来要 ready 交接包。禁止 figma-showcase / 直连 Figma 抽节点。';
  if (record.phase === 'main-static') return 'Main 闸门红或未跑完。用同一 --handoff / --demo 再 start，禁止切 showcase。';
  if (record.phase === 'wait-stop-1') return '第一次给人看：Main 静态。人说继续后执行 npm run torchlightweb -- accept --demo <dir>，再 continue。continue 不会自己签字。';
  if (record.phase === 'later-axes') return '后轴探针未绿。执行 continue 会再跑探针。禁止跳过人核、禁止 source-wired 盖章。';
  if (record.phase === 'wait-stop-2') return '第二次给人看：交互 + 拉伸。人说继续后执行 accept，再 continue 才会 Pack。';
  if (record.phase === 'pack') return 'Pack 未完成。执行 continue 会从 pack 相继续。';
  if (record.phase === 'done') return '状态机完成。不要再加步骤。';
  return '未知相。';
}

function startMachine({ record, root, handoffDir, now, buildMain }) {
  if (!handoffDir && !record.handoffDir) {
    stamp(record, 'need-ready-pack', now);
    const file = writeMachine(root, record);
    return payload(false, record, {
      file,
      error: 'missing-ready-pack',
      nextHumanStep: nextStep(record),
    });
  }
  const pack = handoffDir || record.handoffDir;
  if (record.phase === 'wait-stop-1' || record.phase === 'later-axes' || record.phase === 'wait-stop-2' || record.phase === 'pack' || record.phase === 'done') {
    /* Rebuild Main on the same demo/pack and return to the first human stop.
       Do not accept later stops, do not Pack, do not invent a new workflow. */
    record.phase = 'main-static';
    record.laterAxes = null;
  }
  if (record.handoffDir && handoffDir && resolve(record.handoffDir) !== resolve(handoffDir)) {
    return payload(false, record, {
      error: 'handoff-mismatch',
      nextHumanStep: '同一 demo 不能换交接包。禁止另开 showcase。',
    });
  }
  record.handoffDir = resolve(pack);
  stamp(record, 'main-static', now);
  writeMachine(root, record);

  const main = buildMain({ handoffDir: record.handoffDir, demoDir: root });
  if (!main || main.ok !== true) {
    writeMachine(root, record);
    return payload(false, record, {
      error: 'main-static-red',
      main,
      productView: main?.productView || { url: null, command: null, blocked: true },
      nextHumanStep: 'preview:first / 清单对账 / 政策镜像 红了不许给人打开 ?product=1，也不许开 Interaction / Resize。',
    });
  }

  const presented = presentStop(root, STOP_1, { previewOk: true });
  if (presented.ok !== true) {
    return payload(false, record, {
      error: presented.reason || 'present-stop-1-failed',
      nextHumanStep: 'Main 绿了但停 1 无法 present。禁止跳过人核。',
    });
  }
  record.fingerprint = main.fingerprint || record.fingerprint;
  record.translation = translationOf(root);
  stamp(record, 'wait-stop-1', now);
  const file = writeMachine(root, record);
  return payload(true, record, {
    file,
    waiting: true,
    main,
    humanReview: presented,
    productView: main.productView || null,
    nextHumanStep: nextStep(record),
  });
}

function acceptMachine({ record, root, now }) {
  const stop = currentStop(record.phase);
  if (!stop) {
    return payload(false, record, {
      error: 'accept-not-at-stop',
      nextHumanStep: 'accept 只在停 1 / 停 2 等人核时用。出页和 Pack 不要签字。',
    });
  }
  const accepted = acceptStop(root, stop);
  if (accepted.ok !== true) {
    return payload(false, record, {
      error: accepted.reason || `${stop}-not-accepted`,
      nextHumanStep: stop === STOP_1
        ? '停 1 还没展示或 preview 红，不能签字。'
        : '停 2 还没展示或停 1 没签字，不能签字。',
    });
  }
  writeMachine(root, record);
  return payload(true, record, {
    accepted: true,
    stop,
    humanReview: accepted,
    at: now,
    nextHumanStep: stop === STOP_1
      ? '停 1 已签字。下一步 npm run torchlightweb -- continue --demo <dir> 跑后轴探针。'
      : '停 2 已签字。下一步 continue 才会 Pack。',
  });
}

async function continueMachine({ record, root, now, packDemo, probeLaterAxes }) {
  if (record.missing || record.phase === 'need-ready-pack') {
    return payload(false, record, {
      error: 'missing-ready-pack',
      nextHumanStep: nextStep({ ...record, phase: 'need-ready-pack' }),
    });
  }
  if (record.phase === 'main-static') {
    return payload(false, record, {
      error: 'main-static-incomplete',
      nextHumanStep: nextStep(record),
    });
  }
  if (record.phase === 'done') {
    return payload(true, record, { nextHumanStep: nextStep(record) });
  }

  if (record.phase === 'wait-stop-1') {
    const gate = canStartLaterAxis(root);
    if (gate.ok !== true) {
      return payload(false, record, {
        error: gate.reason || 'stop-1-not-accepted',
        nextHumanStep: '停 1 还没人签字。先 npm run torchlightweb -- accept --demo <dir>。continue 不会自己验收。',
      });
    }
    stamp(record, 'later-axes', now);
    record.translation = translationOf(root);
    writeMachine(root, record);
    return await runLaterAxesPhase({ record, root, now, probeLaterAxes });
  }

  if (record.phase === 'later-axes') {
    return await runLaterAxesPhase({ record, root, now, probeLaterAxes });
  }

  if (record.phase === 'wait-stop-2') {
    const allowed = packAllowedAfterSecondStop(root);
    if (allowed.ok !== true) {
      return payload(false, record, {
        error: allowed.reason || 'stop-2-not-accepted',
        nextHumanStep: '停 2 还没人签字。先 accept，再 continue。禁止 Pack。',
      });
    }
    const probed = readLaterAxesProbe(root);
    if (!laterAxesProbeRecordIsGreen(probed, { demoDir: root })) {
      return payload(false, record, {
        error: 'later-axes-not-probed',
        nextHumanStep: '后轴探针没绿，不能 Pack。空 samples / 缺 1126+1127 切树 / digest 不匹配不算绿。',
      });
    }
    stamp(record, 'pack', now);
    writeMachine(root, record);
    return finishPack({ record, root, now, packDemo });
  }

  if (record.phase === 'pack') {
    const allowed = packAllowedAfterSecondStop(root);
    if (allowed.ok !== true) {
      return payload(false, record, {
        error: allowed.reason || 'stop-2-not-accepted',
        nextHumanStep: '停 2 未验收不能 Pack。',
      });
    }
    const probed = readLaterAxesProbe(root);
    if (!laterAxesProbeRecordIsGreen(probed, { demoDir: root })) {
      return payload(false, record, {
        error: 'later-axes-not-probed',
        nextHumanStep: '后轴探针没绿，不能 Pack。空 samples / 缺 1126+1127 切树 / digest 不匹配不算绿。',
      });
    }
    return finishPack({ record, root, now, packDemo });
  }

  return payload(false, record, { error: `cannot-continue:${record.phase}`, nextHumanStep: nextStep(record) });
}

async function runLaterAxesPhase({ record, root, now, probeLaterAxes }) {
  if (typeof probeLaterAxes !== 'function') {
    return payload(false, record, {
      error: 'later-axes-probe-missing',
      nextHumanStep: '后轴必须跑 Chrome 探针。禁止 source-wired 盖章。',
    });
  }
  const probed = await probeLaterAxes({ demoDir: root });
  const onDisk = readLaterAxesProbe(root);
  const green = probed?.ok === true && laterAxesProbeRecordIsGreen(onDisk, { demoDir: root });
  record.laterAxes = {
    ok: green,
    probed: green,
    interaction: green ? 'probed' : 'red',
    resize: green ? 'probed' : 'red',
    problems: probed?.problems || onDisk.problems || [probed?.error || onDisk.error].filter(Boolean),
  };
  writeMachine(root, record);
  if (!green) {
    return payload(false, record, {
      error: 'later-axes-red',
      laterAxes: record.laterAxes,
      probe: probed,
      laterAxesProbe: onDisk,
      nextHumanStep: nextStep(record),
    });
  }
  const presented = presentStop(root, STOP_2, { previewOk: true });
  if (presented.ok !== true) {
    return payload(false, record, {
      error: presented.reason || 'present-stop-2-failed',
      nextHumanStep: '后轴探针绿了但停 2 无法 present。禁止跳过人核去 Pack。',
    });
  }
  stamp(record, 'wait-stop-2', now);
  const file = writeMachine(root, record);
  return payload(true, record, {
    file,
    waiting: true,
    laterAxes: record.laterAxes,
    humanReview: presented,
    productView: productViewForDemo(root),
    nextHumanStep: nextStep(record),
  });
}

function finishPack({ record, root, now, packDemo }) {
  if (existsSync(join(root, 'resize-acceptance.json'))) {
    return payload(false, record, {
      error: 'machine-resize-acceptance-forbidden',
      nextHumanStep: 'Pack 不认机器写的 resize-acceptance.json。删掉后靠停 2 人核 + 后轴探针。',
    });
  }
  const packed = packDemo({ demoDir: root });
  if (!packed || packed.ok !== true) {
    return payload(false, record, {
      error: 'pack-red',
      pack: packed,
      nextHumanStep: 'Pack 红了停在 pack 相。禁止跳过压缩宣称完成。',
    });
  }
  stamp(record, 'done', now);
  const file = writeMachine(root, record);
  return payload(true, record, {
    file,
    pack: packed,
    nextHumanStep: nextStep(record),
  });
}
