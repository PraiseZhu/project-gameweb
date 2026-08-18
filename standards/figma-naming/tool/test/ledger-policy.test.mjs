import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICY_VERSION, CHANNELS, EXEC_STATES,
  classifyChannel, passesRecurrenceGate, passesAttributionGate, passesDeterminismGate,
  evaluateAdmission, canAutoLand, nextExecState,
  validateTerminalNote, validatePartialDecisions, assessTerminalCompliance,
  graduationPlan, graduationRecovery,
} from '../src/ledger-policy.mjs';

test('policy version is v3.1', () => {
  assert.equal(POLICY_VERSION, 'v3.1');
});

test('recurrence gate requires two distinct instances, same-report repeats do not count', () => {
  // 同一日同一会话、且没有独立实例 → 不算跨实例
  assert.equal(passesRecurrenceGate([{ date: '2026-08-10', session: 's1' }, { date: '2026-08-10', session: 's1' }]).pass, false);
  // 同一日但不同验收文件 → 算
  assert.equal(passesRecurrenceGate([
    { date: '2026-08-10', session: 's1', instance: 'apply-plan-1.json' },
    { date: '2026-08-10', session: 's1', instance: 'apply-plan-2.json' },
  ]).pass, true);
  // 跨日 → 算
  assert.equal(passesRecurrenceGate([{ date: '2026-08-10' }, { date: '2026-08-11' }]).pass, true);
  // 跨会话 → 算
  assert.equal(passesRecurrenceGate([{ session: 'a' }, { session: 'b' }]).pass, true);
  // 单条 → 不算
  assert.equal(passesRecurrenceGate([{ date: '2026-08-11' }]).pass, false);
});

test('attribution gate defaults to pending and only confirmed passes', () => {
  assert.equal(passesAttributionGate({}).pass, false);            // 默认 pending
  assert.equal(passesAttributionGate({ attribution: 'pending' }).pass, false);
  assert.equal(passesAttributionGate({ attribution: 'confirmed' }).pass, true);
});

test('determinism gate requires change target, criterion and reverify', () => {
  assert.equal(passesDeterminismGate({ changeTarget: 'x', criterion: 'y', reverify: 'z' }).pass, true);
  const miss = passesDeterminismGate({ changeTarget: 'x' });
  assert.equal(miss.pass, false);
  assert.deepEqual(miss.missing, ['criterion', 'reverify']);
});

test('channel classification: uncertain falls back to expansion, never auto-tighten', () => {
  assert.equal(classifyChannel({ certain: false }), 'expansion');       // 拿不准=扩权
  assert.equal(classifyChannel({ relaxesAcceptance: true, certain: true }), 'expansion');
  assert.equal(classifyChannel({ isDesignObservation: true, certain: true }), 'design');
  assert.equal(classifyChannel({ certain: true }), 'tighten');
});

test('expansion or unknown channel never enters implementation queue (canAutoLand=false)', () => {
  // 扩权：过复发/归因/确定性也不自动落地
  const expansion = {
    channel: 'expansion', attribution: 'confirmed',
    changeTarget: 't', criterion: 'c', reverify: 'r',
    evidence: [{ date: '2026-08-10' }, { date: '2026-08-11' }],
  };
  assert.equal(canAutoLand(expansion), false);
  // 设计类同样不落地
  assert.equal(canAutoLand({ ...expansion, channel: 'design' }), false);
});

test('single pure tighten may skip recurrence gate but still needs confirmed attribution and determinism', () => {
  const base = { channel: 'tighten', single: true, changeTarget: 't', criterion: 'c', reverify: 'r' };
  // 缺 confirmed 归因 → 不通过
  assert.equal(evaluateAdmission({ ...base, attribution: 'pending' }).admitted, false);
  // 齐全 → 通过（复发门被 single-tighten 跳过）
  const ok = evaluateAdmission({ ...base, attribution: 'confirmed' });
  assert.equal(ok.admitted, true);
  assert.equal(ok.gates.recurrence.skipped, 'single-tighten');
  // 通过门的纯收紧可进入实施建议（但仍不自动合并/推送）
  assert.equal(canAutoLand({ ...base, attribution: 'confirmed' }), true);
});

test('non-single tighten still requires recurrence across instances', () => {
  const t = { channel: 'tighten', attribution: 'confirmed', changeTarget: 't', criterion: 'c', reverify: 'r', evidence: [{ date: '2026-08-11' }] };
  assert.equal(evaluateAdmission(t).admitted, false);   // 单实例，复发门不过
  assert.equal(evaluateAdmission({ ...t, evidence: [{ date: '2026-08-10' }, { date: '2026-08-11' }] }).admitted, true);
});

test('three exec states advance only through implement then land', () => {
  assert.equal(nextExecState('proposal-created', 'implement'), 'implemented-awaiting-merge');
  assert.equal(nextExecState('implemented-awaiting-merge', 'land'), 'landed-effective');
  assert.equal(nextExecState('proposal-created', 'land'), 'proposal-created');   // 不能跳级
  assert.equal(EXEC_STATES.length, 3);
});

test('legacy tracked without decided note is not treated as compliant terminal', () => {
  const legacy = assessTerminalCompliance({ status: 'tracked', note: null, noteLegacy: true });
  assert.equal(legacy.compliant, false);
  assert.equal(legacy.legacy, true);
  const missing = assessTerminalCompliance({ status: 'tracked', note: null });
  assert.equal(missing.compliant, false);
  const ok = assessTerminalCompliance({ status: 'tracked', note: '[decided:2026-08-14] 只观察' });
  assert.equal(ok.compliant, true);
});

test('terminal note discipline: landed/adopted/rejected/tracked need [decided:YYYY-MM-DD]', () => {
  assert.equal(validateTerminalNote('landed', '[decided:2026-08-11] 已合并').ok, true);
  assert.equal(validateTerminalNote('landed', '已合并但没日期').ok, false);
  assert.equal(validateTerminalNote('adopted', '').ok, false);
  assert.equal(validateTerminalNote('open', '任意').ok, true);   // 非终态不强制
  assert.equal(validateTerminalNote('tracked', '[decided:2026-99-99] 假日期').ok, false);
  assert.equal(validateTerminalNote('tracked', '[decided:0000-00-00] 假日期').ok, false);
});

test('partial decisions use [part:N][adopted|rejected] with continuous numbering', () => {
  assert.equal(validatePartialDecisions(['[part:1][adopted] a', '[part:2][rejected] b']).ok, true);
  assert.equal(validatePartialDecisions(['[part:2][adopted] a']).ok, false);   // 从 2 开始
  assert.equal(validatePartialDecisions(['[part:1][adopted] a', '[part:1][adopted] b']).ok, false); // 重复
  assert.equal(validatePartialDecisions(['没前缀']).ok, false);
});

test('graduation is two-step: catalog readback before ledger close, else graduation-pending', () => {
  const plan = graduationPlan('font-routing-mismatch');
  assert.equal(plan.gradKey, 'grad-font-routing-mismatch');
  assert.deepEqual(plan.steps, ['write-catalog', 'readback-catalog', 'close-ledger']);
  // 全确认 → graduated
  assert.equal(graduationRecovery({ catalogWritten: true, catalogVerified: true, ledgerClosed: true }).state, 'graduated');
  // 任一步缺失 → graduation-pending
  assert.equal(graduationRecovery({ catalogWritten: true, catalogVerified: true, ledgerClosed: false }).state, 'graduation-pending');
  assert.equal(graduationRecovery({}).pending, true);
});
