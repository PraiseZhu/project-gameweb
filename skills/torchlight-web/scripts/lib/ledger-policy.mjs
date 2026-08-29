/* ledger-policy.mjs — v3.1 台账立法的可测试规则实现。
 *
 * 上位规则：docs/ledger-legislation.md（v3.1 本项目适配版）。
 * 本模块只做纯函数判定，不写文件、不碰 Git —— 写盘唯一入口是 scripts/evolution-note.mjs，
 * 晨读报告由 scripts/daily-ledger.mjs 渲染。所有规则都可被 scripts/__tests__ 隔离复验。
 *
 * 覆盖 v3.1 已提供的条款（不补写未提供的后续条文）：
 *   - 四道准入门（复发/归因/确定性/类型），拿不准一律按扩权；
 *   - 三通道（收紧/扩权/设计）与三态（proposal-created/implemented-awaiting-merge/landed-effective）；
 *   - 终态决策 note 纪律（[decided:YYYY-MM-DD]）与部分采纳语法（[part:N][adopted|rejected]）；
 *   - gap-catalog 毕业两步合同（先 catalog 后 ledger）与 graduation-pending 幂等恢复（grad-<fingerprint>）。
 */

export const POLICY_VERSION = 'v3.1';

/* ── 三通道 ── */
export const CHANNELS = ['tighten', 'expansion', 'design'];
/* ── 三态（执行状态，与 legacy 单 status 兼容并存）── */
export const EXEC_STATES = ['proposal-created', 'implemented-awaiting-merge', 'landed-effective'];
/* ── 归因门取值 ── */
export const ATTRIBUTION = ['confirmed', 'pending'];
/* ── 终态（需要 [decided:] 纪律的状态）── */
export const TERMINAL_STATUSES = ['landed', 'adopted', 'rejected', 'tracked'];

export const DECIDED_RE = /^\[decided:\d{4}-\d{2}-\d{2}\]/;
export const PART_RE = /^\[part:(\d+)\]\[(adopted|rejected)\]/;

/** 类型门：把一条候选分类到三通道。拿不准 → expansion（扩权），绝不自动当收紧。 */
export function classifyChannel({ relaxesAcceptance = false, isDesignObservation = false, certain = false } = {}) {
  if (isDesignObservation) return 'design';
  // 明确会放宽验收口径 → 扩权；拿不准（!certain）→ 也按扩权。
  if (relaxesAcceptance || !certain) return 'expansion';
  return 'tighten';
}

/** 复发门：至少两次，且来自不同日期/验收实例/会话；同一份报告内的重复不算。 */
export function passesRecurrenceGate(evidence = []) {
  const instances = new Set();
  for (const ev of evidence) {
    // 每条证据必须能定位到一个独立实例：日期 / 会话 / 验收实例之一。
    const key = ev && (ev.date || ev.session || ev.instance);
    if (key) instances.add(String(key));
  }
  return { pass: instances.size >= 2, distinctInstances: instances.size };
}

/** 归因门：自动抓到的失败默认 pending；只有完整证据链才 confirmed。 */
export function passesAttributionGate({ attribution = 'pending' } = {}) {
  return { pass: attribution === 'confirmed', attribution };
}

/** 确定性门：必须说清「改哪里、加什么判据、如何复验」三者齐全。 */
export function passesDeterminismGate({ changeTarget = '', criterion = '', reverify = '' } = {}) {
  const ok = [changeTarget, criterion, reverify].every((s) => String(s || '').trim().length > 0);
  return { pass: ok, missing: ['changeTarget', 'criterion', 'reverify'].filter((k, i) => !String([changeTarget, criterion, reverify][i] || '').trim()) };
}

/**
 * 四道准入门汇总。single-tighten（单次纯收紧）只可跳过复发门，仍需确认归因+明确落点+明确类型。
 * 返回 { admitted, channel, gates, failedGates }；未通过任一适用门 → 留观察区。
 */
export function evaluateAdmission(candidate = {}) {
  const channel = candidate.channel || classifyChannel(candidate);
  const singleTighten = channel === 'tighten' && candidate.single === true;
  const gates = {
    recurrence: singleTighten ? { pass: true, skipped: 'single-tighten' } : passesRecurrenceGate(candidate.evidence || []),
    attribution: passesAttributionGate(candidate),
    determinism: passesDeterminismGate(candidate),
    channel: { pass: CHANNELS.includes(channel), channel },
  };
  const failedGates = Object.keys(gates).filter((k) => !gates[k].pass);
  return { admitted: failedGates.length === 0, channel, gates, failedGates };
}

/**
 * 扩权保护：expansion 或类型不明的条目永远只写建议、绝不进入实施队列、绝不触发 Git。
 * 返回 true 表示「允许进入当日实施建议」。
 */
export function canAutoLand(candidate = {}) {
  const { admitted, channel } = evaluateAdmission(candidate);
  if (!admitted) return false;
  if (channel !== 'tighten') return false;   // 扩权/设计均不自动落地
  return true;                                // 收紧且过所有适用门，仍不自动合并/推送/发布（由 owner 推进）
}

/** 三态推进：landed-effective 才可进入复发归零验证。 */
export function nextExecState(current, event) {
  const order = ['proposal-created', 'implemented-awaiting-merge', 'landed-effective'];
  const cur = order.indexOf(current);
  if (cur < 0) return 'proposal-created';
  if (event === 'implement' && current === 'proposal-created') return 'implemented-awaiting-merge';
  if (event === 'land' && current === 'implemented-awaiting-merge') return 'landed-effective';
  return current;
}

/** 终态决策 note 纪律：landed/adopted/rejected/tracked 必须以 [decided:YYYY-MM-DD] 开头。 */
export function validateTerminalNote(status, note) {
  if (!TERMINAL_STATUSES.includes(status)) return { ok: true };  // 非终态不强制
  const text = String(note || '');
  if (!DECIDED_RE.test(text)) return { ok: false, reason: `status=${status} 的 note 必须以 [decided:YYYY-MM-DD] 开头` };
  return { ok: true };
}

/** 部分采纳语法：[part:N][adopted|rejected]，N 必须连续编号。parts 为 note 数组。 */
export function validatePartialDecisions(parts = []) {
  const seen = [];
  for (const p of parts) {
    const m = String(p || '').match(PART_RE);
    if (!m) return { ok: false, reason: `部分采纳记录缺 [part:N][adopted|rejected] 前缀：${String(p).slice(0, 40)}` };
    seen.push(Number(m[1]));
  }
  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) return { ok: false, reason: `[part:N] 必须从 1 连续编号，实见 ${sorted.join(',')}` };
  }
  return { ok: true, count: sorted.length };
}

/** gap-catalog 毕业两步合同：先写 catalog 并回读确认，再结案 ledger。 */
export function graduationPlan(fingerprint) {
  return {
    fingerprint,
    gradKey: `grad-${fingerprint}`,
    steps: ['write-catalog', 'readback-catalog', 'close-ledger'],
    pendingState: 'graduation-pending',
  };
}

/** 毕业幂等恢复：任一步不确定 → 保留 graduation-pending，按 grad-<fingerprint> 恢复，不覆盖冲突。 */
export function graduationRecovery({ catalogWritten = false, catalogVerified = false, ledgerClosed = false } = {}) {
  if (catalogWritten && catalogVerified && ledgerClosed) return { state: 'graduated', pending: false };
  return { state: 'graduation-pending', pending: true, reason: '先 catalog 后 ledger 两步未全部确认，保留 graduation-pending 待恢复' };
}
