import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CONTRACT_FILENAME,
  LEDGER_PATH,
  SKILLS_DIR,
  checkSkillSync,
  extractRoleKind,
  formatReport,
  listSkills,
  loadLedger,
  resolveSkillRoles,
  todayISO,
} from "../scripts/check-skill-sync.mjs";
import { PREFIX_NAMES } from "../src/spec.mjs";

const SPEC_ROLES = ["sec", "img", "btn"];
const NOW = new Date("2026-08-13T10:00:00");

function sandbox() {
  const dir = mkdtempSync(resolve(tmpdir(), "figma-naming-lint-skill-sync-"));
  const skillsDir = join(dir, "skills");
  mkdirSync(skillsDir, { recursive: true });
  const ledgerPath = join(dir, "skill-conflicts.json");
  const writeLedger = (known) => writeFileSync(ledgerPath, JSON.stringify({ version: 1, known }, null, 2));
  const writeSkill = (name, files) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(skillsDir, name, rel);
      mkdirSync(resolve(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    }
  };
  const run = (overrides = {}) => checkSkillSync({ skillsDir, ledgerPath, specRoles: SPEC_ROLES, now: NOW, ...overrides });
  return { dir, skillsDir, ledgerPath, writeLedger, writeSkill, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const wordlistSource = (roles) => `
export const ROLE_KIND = {
${roles.map((r) => `  ${r}: 'structural',   // 注释里也写 kind: structural 试试`).join("\n")}
};
export const KNOWN_ROLES = Object.keys(ROLE_KIND);
`;

const entry = (over = {}) => ({
  skill: "s1", role: "txt", why: "与规范正面抵触", reviewBy: "2026-11-12", status: "pending-adoption", ...over,
});

/* ------------------------------------------------------------------ *
 * 分级策略：三档必须各自可辨
 * ------------------------------------------------------------------ */

test("check-skills：总表没有、名单也没有的角色 → 硬拦", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["sec", "txt"]) });
    const result = box.run();
    assert.equal(result.status, "blocked");
    assert.equal(result.warnings.length, 0);
    assert.ok(result.blockers.some((b) => b.includes("`txt`") && b.includes("s1")), `硬拦应点名 s1 的 txt：${JSON.stringify(result.blockers)}`);
    assert.deepEqual(result.skills[0].extras, [{ role: "txt", verdict: "unregistered" }]);
  } finally { box.cleanup(); }
});

test("check-skills：在名单里且未过 reviewBy → 只警告，不硬拦", () => {
  const box = sandbox();
  try {
    box.writeLedger([entry()]);
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["sec", "txt"]) });
    const result = box.run();
    assert.equal(result.status, "warn");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("2026-11-12"), "警告里要带上复审期，否则看不出还剩多久");
    assert.equal(result.skills[0].extras[0].verdict, "known");
  } finally { box.cleanup(); }
});

/**
 * 过期即升级是这套机制不烂掉的关键：没有它，名单就是「登记一次永远不用管」的垃圾桶。
 *
 * 判别性用例刻意同时放了两条：一条已过期、一条未过期，且**性质相同**（都在名单里、
 * 都不在总表）。只放过期那一条的话，「reviewBy 一律当过期」这种把判定变宽的实现
 * 也能全绿——两条一起才逼出「必须按日期分流」。
 */
test("check-skills：名单里但已过 reviewBy → 升级成硬拦；同一次里未过期的仍只警告", () => {
  const box = sandbox();
  try {
    box.writeLedger([
      entry({ role: "txt", reviewBy: "2026-01-01", why: "与规范正面抵触" }),
      entry({ role: "swpage", reviewBy: "2026-11-12", why: "规范未覆盖的新概念" }),
    ]);
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["sec", "txt", "swpage"]) });
    const result = box.run();
    assert.equal(result.status, "blocked");
    assert.equal(result.blockers.length, 1, `只有过期那条该硬拦：${JSON.stringify(result.blockers)}`);
    assert.ok(result.blockers[0].includes("`txt`"));
    assert.ok(result.blockers[0].includes("已过复审期"));
    assert.ok(result.blockers[0].includes("与规范正面抵触"), "硬拦里要带上登记时写的性质，否则读的人不知道该怎么处置");
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("`swpage`"));
    const verdicts = Object.fromEntries(result.skills[0].extras.map((e) => [e.role, e.verdict]));
    assert.deepEqual(verdicts, { txt: "expired", swpage: "known" });
  } finally { box.cleanup(); }
});

/** 边界：reviewBy == 今天 还没过期（当天仍算在复审期内） */
test("check-skills：reviewBy 正好是今天不算过期，前一天才算", () => {
  const box = sandbox();
  try {
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["txt"]) });
    box.writeLedger([entry({ reviewBy: todayISO(NOW) })]);
    assert.equal(box.run().status, "warn");
    box.writeLedger([entry({ reviewBy: "2026-08-12" })]);
    assert.equal(box.run().status, "blocked");
  } finally { box.cleanup(); }
});

/* ------------------------------------------------------------------ *
 * 名单本身
 * ------------------------------------------------------------------ */

test("check-skills：名单条目缺任一必填字段就抛错，不静默放行", () => {
  const box = sandbox();
  try {
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["txt"]) });
    for (const field of ["skill", "role", "why", "reviewBy", "status"]) {
      const broken = entry();
      delete broken[field];
      box.writeLedger([broken]);
      assert.throws(() => box.run(), new RegExp(field), `缺 ${field} 应抛错`);
    }
    box.writeLedger([entry({ reviewBy: "2026/11/12" })]);
    assert.throws(() => box.run(), /ISO 日期/);
    box.writeLedger([entry({ why: "   " })]);
    assert.throws(() => box.run(), /why/);
  } finally { box.cleanup(); }
});

test("check-skills：名单文件缺失或 JSON 非法时抛错，不退回空名单", () => {
  const box = sandbox();
  try {
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["txt"]) });
    assert.throws(() => box.run(), /缺少已知名单/);
    writeFileSync(box.ledgerPath, "{ not json");
    assert.throws(() => box.run(), /不是有效 JSON/);
    writeFileSync(box.ledgerPath, JSON.stringify({ version: 1 }));
    assert.throws(() => box.run(), /known/);
  } finally { box.cleanup(); }
});

test("check-skills：名单里登记了但本次没命中的条目要说出来（否则名单只增不减）", () => {
  const box = sandbox();
  try {
    box.writeLedger([entry({ role: "gone" })]);
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["sec"]) });
    const result = box.run();
    assert.equal(result.status, "ok");
    assert.ok(result.notes.some((n) => n.includes("s1::gone")), `应提示可清理：${JSON.stringify(result.notes)}`);
  } finally { box.cleanup(); }
});

/* ------------------------------------------------------------------ *
 * 角色来源：契约优先、词表回落、找不到就报
 * ------------------------------------------------------------------ */

test("check-skills：有契约时以契约为准，且输出不标「未接契约」", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("s1", {
      [CONTRACT_FILENAME]: JSON.stringify({ targetSpecVersion: "v2.7 (2026-08-07)", rolesUsed: ["sec", "btn"] }),
      // 词表里有一个总表没有的角色：如果实现忽略契约去扫词表，这里会硬拦。
      "scripts/lib/names.mjs": wordlistSource(["sec", "btn", "zzz"]),
    });
    const result = box.run();
    assert.equal(result.status, "ok", `契约应压过词表：${JSON.stringify(result.blockers)}`);
    assert.equal(result.skills[0].source, "contract");
    assert.ok(!formatReport(result).includes("未接契约"));
  } finally { box.cleanup(); }
});

test("check-skills：走词表回落时必须显式标注「未接契约」", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("s1", { "scripts/lib/names.mjs": wordlistSource(["sec"]) });
    const result = box.run();
    assert.equal(result.skills[0].source, "wordlist");
    assert.ok(result.notes.some((n) => n.includes("未接契约")), `备注里要标：${JSON.stringify(result.notes)}`);
    assert.ok(formatReport(result).includes("未接契约"), "终端输出里也要能看见，不能只藏在 JSON 里");
  } finally { box.cleanup(); }
});

/**
 * 判别性用例：两个 skill、两处不同的文件名与目录深度。
 * 只有一个 skill 时，把路径/变量名写死成 `skills/yise-web-ui/scripts/lib/figma-name-semantics.mjs`
 * 的实现也能全绿——第二个 skill 才逼出「不许写死」。
 */
test("check-skills：多个 skill、任意文件名与目录深度都能扫到，路径不写死", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("alpha", { "scripts/lib/figma-name-semantics.mjs": wordlistSource(["sec"]) });
    box.writeSkill("beta", { "src/deep/nested/roles.mjs": wordlistSource(["sec", "beta_only"]) });
    const result = box.run();
    assert.deepEqual(result.skills.map((s) => s.skill), ["alpha", "beta"]);
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some((b) => b.includes("beta") && b.includes("beta_only")));
    assert.deepEqual(result.skills[1].files, ["src/deep/nested/roles.mjs"]);
  } finally { box.cleanup(); }
});

test("check-skills：既无契约也扫不到词表 → 报出来，不当作零冲突通过", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("s1", { "README.md": "这个目录没有任何角色词表" });
    const result = box.run();
    assert.equal(result.status, "blocked", "沉默失败是禁止的");
    assert.equal(result.skills[0].source, "none");
    assert.ok(result.blockers.some((b) => b.includes("角色来源未知")));
  } finally { box.cleanup(); }
});

test("check-skills：契约文件坏了 / 缺字段 → 硬拦，不悄悄回落词表", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("s1", {
      [CONTRACT_FILENAME]: "{ not json",
      "scripts/lib/names.mjs": wordlistSource(["sec"]),
    });
    assert.equal(box.run().status, "blocked");

    box.writeSkill("s1", { [CONTRACT_FILENAME]: JSON.stringify({ rolesUsed: ["sec"] }) });
    const missingVersion = box.run();
    assert.equal(missingVersion.status, "blocked");
    assert.ok(missingVersion.blockers.some((b) => b.includes("targetSpecVersion")));

    box.writeSkill("s1", { [CONTRACT_FILENAME]: JSON.stringify({ targetSpecVersion: "v2.7 (2026-08-07)" }) });
    const missingRoles = box.run();
    assert.equal(missingRoles.status, "blocked");
    assert.ok(missingRoles.blockers.some((b) => b.includes("rolesUsed")));
  } finally { box.cleanup(); }
});

test("check-skills：契约声明的 targetSpecVersion 落后于当前规范时给警告", () => {
  const box = sandbox();
  try {
    box.writeLedger([]);
    box.writeSkill("s1", { [CONTRACT_FILENAME]: JSON.stringify({ targetSpecVersion: "v1.0 (2020-01-01)", rolesUsed: ["sec"] }) });
    const result = box.run();
    assert.equal(result.status, "warn");
    assert.ok(result.warnings[0].includes("targetSpecVersion"));
  } finally { box.cleanup(); }
});

/* ------------------------------------------------------------------ *
 * 词表解析
 * ------------------------------------------------------------------ */

test("extractRoleKind：只取真正的键，不把注释里的 `kind: structural` 当角色", () => {
  const roles = extractRoleKind(`
export const ROLE_KIND = {
  // kind: structural —— 这行是注释
  sec: 'structural',    // 分区
  /* block: comment */
  img: 'asset',
  'txt': 'widget',
};
`);
    assert.deepEqual(roles.sort(), ["img", "sec", "txt"]);
});

test("extractRoleKind：嵌套花括号不会让解析提前收尾", () => {
  const roles = extractRoleKind(`
export const ROLE_KIND = {
  sec: { kind: 'structural' },
  img: { kind: 'asset' },
};
export const OTHER = { zzz: 1 };
`);
  assert.deepEqual(roles.sort(), ["img", "sec"]);
  assert.ok(!roles.includes("zzz"), "不能把 ROLE_KIND 之后的对象也吞进来");
});

test("extractRoleKind：没有该导出时返回 null（由调用方决定怎么处理，而不是返回空数组假装成功）", () => {
  assert.equal(extractRoleKind("export const SOMETHING_ELSE = { a: 1 };"), null);
});

/* ------------------------------------------------------------------ *
 * skills/ 不存在
 * ------------------------------------------------------------------ */

test("check-skills：skills/ 不存在时跳过并说明，不报错也不假装通过", () => {
  const box = sandbox();
  try {
    const result = checkSkillSync({ skillsDir: join(box.dir, "no-such-skills"), ledgerPath: box.ledgerPath, specRoles: SPEC_ROLES, now: NOW });
    assert.equal(result.status, "skipped");
    assert.ok(result.skipped.includes("跳过"));
    assert.deepEqual(result.skills, []);
    assert.ok(formatReport(result).includes("跳过"));
    assert.equal(listSkills(join(box.dir, "no-such-skills")), null);
  } finally { box.cleanup(); }
});

/* ------------------------------------------------------------------ *
 * 真仓状态：npm test 必须真的跑到这个检查
 * ------------------------------------------------------------------ */

test("check-skills：本仓当前状态不得为硬拦（skills/ 缺失时跳过）", () => {
  const result = checkSkillSync();
  if (result.status === "skipped") {
    assert.ok(result.skipped.includes("skills"), "跳过原因要说清是没有 skills/");
    return;
  }
  assert.notEqual(result.status, "blocked", `跨目录冲突检查未通过：\n${formatReport(result)}`);
  assert.equal(result.specRoles.length, PREFIX_NAMES.length);
});

test("check-skills：随仓名单本身合法且每条都有性质与复审期", () => {
  const ledger = loadLedger(LEDGER_PATH);
  assert.ok(ledger.known.length > 0, "名单为空的话上面那条真仓检查就测不出东西");
  for (const item of ledger.known) {
    assert.ok(item.why.length > 10, `${item.skill}::${item.role} 的 why 太短，说不清性质`);
    assert.match(item.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("check-skills：真仓 skills/ 下每个目录都能拿到角色来源", () => {
  const names = listSkills(SKILLS_DIR);
  if (names === null) return; // 公开仓可能没有 skills/
  for (const name of names) {
    const resolved = resolveSkillRoles(join(SKILLS_DIR, name), name);
    assert.ok(["contract", "wordlist"].includes(resolved.source), `${name} 角色来源未知：${JSON.stringify(resolved.problems)}`);
    assert.ok(resolved.roles.length > 0, `${name} 解析出 0 个角色，八成是解析失效了`);
  }
});
