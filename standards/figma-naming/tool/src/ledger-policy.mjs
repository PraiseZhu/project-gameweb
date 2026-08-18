/* ledger-policy.mjs — v3.1 台账立法的可测试规则实现。
 *
 * 上位规则：../docs/ledger-legislation.md（v3.1 · Figma 命名适配版）。
 * 本模块只做纯函数判定，不写文件、不碰 Git —— 写盘唯一入口是 bin/evolution-note.mjs，
 * 晨读报告由 bin/daily-ledger.mjs 渲染。所有规则都可被 test/ledger-policy.test.mjs 隔离复验。
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

export const DECIDED_RE = /^\[decided:(\d{4})-(\d{2})-(\d{2})\]/;
export const PART_RE = /^\[part:(\d+)\]\[(adopted|rejected)\]/;

export function isValidChinaDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

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
    if (!ev) continue;
    // 优先用可定位实例；没有实例时才退回日期或会话，避免同日同类被压成一次。
    const key = ev.instance || ev.session || ev.date;
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
  const match = text.match(DECIDED_RE);
  if (!match) return { ok: false, reason: `status=${status} 的 note 必须以 [decided:YYYY-MM-DD] 开头` };
  if (!isValidChinaDate(match[1], match[2], match[3])) {
    return { ok: false, reason: `status=${status} 的 decided 日期不是合法日历日：${match[1]}-${match[2]}-${match[3]}` };
  }
  return { ok: true };
}

/** 已有终态条目：合法 decided note 才算合规；noteLegacy 只表示历史条目，不当已批准终态。 */
export function assessTerminalCompliance(entry = {}) {
  if (!TERMINAL_STATUSES.includes(entry.status)) {
    return { compliant: true, legacy: false, applicable: false };
  }
  if (entry.noteLegacy === true) {
    return { compliant: false, legacy: true, applicable: true, reason: 'legacy / 不可计算' };
  }
  const checked = validateTerminalNote(entry.status, entry.note);
  return { compliant: checked.ok, legacy: false, applicable: true, reason: checked.reason };
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
