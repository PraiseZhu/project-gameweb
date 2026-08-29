#!/usr/bin/env node
/**
 * fonts-install.mjs — 字体交付的受控引导与离线校验器。【两层字体交付设计的第 2 层】
 *
 * 设计（2026-08-11 用户裁决）：字体是**运行时依赖**，不是页面资产。
 *   第 1 层：当前已验证的字体二进制随 Skill 捆绑在 fonts/ —— clone 即有确定性离线保真；
 *   第 2 层：本脚本提供 `fonts:install`/`fonts:check`，由 fonts/registry.json 驱动，
 *            校验每个文件的存在性 / 字节数 / sha256 / 家族-字重映射，缺失或不符时
 *            按 registry 里登记的 source 给出**明确的重装指引**，绝不静默替换或虚报许可。
 *
 * 纪律（与 figma-fonts.mjs / assets-manifest 同口径）：
 *   - registry.json 是唯一事实源（家族 → 文件 / postScriptName / weight / source / license / sha256）。
 *   - 校验失败的字体进入 problems 清单并以非零退出 —— 不许把"缺字体"做成"通过"。
 *   - 许可不明的字体会被单独标出（reviewStatus），不作为"可安全再分发"宣称。
 *
 * 用法：
 *   node scripts/fonts-install.mjs            # 校验 fonts/ 与 registry 一致（默认 check）
 *   node scripts/fonts-install.mjs --check    # 同上，显式
 *   node scripts/fonts-install.mjs --install  # 校验 + 对缺失文件打印 source 重装指引（不联网下载）
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 根目录默认取脚本所在的 Skill 根；--root <dir> 可覆盖（测试/其他 checkout 校验用）。 */
const _rootArgIdx = process.argv.indexOf('--root');
const ROOT = _rootArgIdx >= 0 && process.argv[_rootArgIdx + 1]
  ? resolve(process.argv[_rootArgIdx + 1])
  : resolve(fileURLToPath(new URL('..', import.meta.url)));
const FONTS_DIR = join(ROOT, 'fonts');
const REG_PATH = join(FONTS_DIR, 'registry.json');

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--install') ? 'install' : 'check';
  const problems = [];
  const ok = [];
  const reinstall = [];

  if (!existsSync(REG_PATH)) {
    console.log(JSON.stringify({ ok: false, error: `缺字体登记册 ${REG_PATH}` }, null, 2));
    process.exit(1);
  }
  const reg = JSON.parse(readFileSync(REG_PATH, 'utf8'));
  const families = reg.families || {};

  for (const [family, entry] of Object.entries(families)) {
    const file = entry.file;
    if (!file) {
      problems.push(`${family}: registry 未登记 file（缺失字体文件，见 source 指引）`);
      reinstall.push({ family, file: null, source: entry.source || null, license: entry.license || null, note: entry.missing || 'registry.file 为空' });
      continue;
    }
    const abs = join(FONTS_DIR, file);
    if (!existsSync(abs)) {
      problems.push(`${family}: fonts/${file} 不在本地`);
      reinstall.push({ family, file, source: entry.source || null, license: entry.license || null, note: '文件缺失，按 source 重装后回填' });
      continue;
    }
    const buf = readFileSync(abs);
    const bytes = statSync(abs).size;
    // 字节数校验（registry.bytes 存在时）
    if (entry.bytes != null && bytes !== entry.bytes) {
      problems.push(`${family}: fonts/${file} 字节数 ${bytes} ≠ registry.bytes ${entry.bytes}（文件可能被改动或损坏）`);
      continue;
    }
    // sha256 校验（registry.sha256 存在时）——二进制无 JSON locator，哈希是可校验锚点
    if (entry.sha256) {
      const hash = createHash('sha256').update(buf).digest('hex');
      if (hash !== entry.sha256) {
        problems.push(`${family}: fonts/${file} sha256 不符（${hash.slice(0, 16)}… ≠ 登记 ${entry.sha256.slice(0, 16)}…）`);
        reinstall.push({ family, file, source: entry.source || null, license: entry.license || null, note: '哈希不符，按 source 重装' });
        continue;
      }
    }
    // 家族-字重映射完整性：必须能在 registry 里看到 weight/postScriptName
    if (entry.weight == null || !entry.postScriptName) {
      problems.push(`${family}: registry 缺 weight 或 postScriptName（家族-字重映射不完整）`);
      continue;
    }
    ok.push({ family, file, bytes, weight: entry.weight, source: entry.source || null, license: entry.license || null });
  }

  // 许可审查提示：任何 license 未明确/标注待审的字体单独列出，不静默宣称安全
  const licenseReview = Object.entries(families)
    .filter(([, e]) => e.licenseReview || !e.license || /待|确认|unclear|review/i.test(String(e.license)))
    .map(([family, e]) => ({ family, file: e.file || null, license: e.license || null, note: e.licenseReview || '许可未明确，需人工审查后再分发' }));

  const out = {
    ok: problems.length === 0,
    mode,
    registry: 'fonts/registry.json',
    bundled: ok.length,
    missingOrInvalid: problems.length,
    families: ok,
    licenseReview,
    problems,
  };
  if (mode === 'install' && reinstall.length) {
    out.reinstallGuide = reinstall.map((r) => ({
      ...r,
      action: r.source
        ? `从登记来源获取并放入 fonts/：${r.source}（放入后重跑 fonts:check 校验 sha256）`
        : 'registry 未记录 source —— 需先补登 source 再重装，不得从无来源处随意获取',
    }));
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(problems.length ? 1 : 0);
}

main();
