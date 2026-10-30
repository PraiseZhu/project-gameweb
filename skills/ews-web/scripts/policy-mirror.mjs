#!/usr/bin/env node
/**
 * Mirror EWS DESIGN.md against the live screen-runtime exports.
 * Parses DESIGN.md with the shared tool; implementation comes from runtime,
 * not from implementationFromPolicy(policy).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ewsImplementationFromRuntime, resolveDesignPolicyTools } from './lib/policy-implementation.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sixFields(row) {
  return {
    schema: row.schema,
    mobileMaxWidth: row.mobileMaxWidth,
    rootFontVw: row.rootFontVw,
    wideAspectMin: row.wideAspectMin,
    wideRootFontVh: row.wideRootFontVh,
    screenHeight: row.screenHeight,
  };
}

export async function runPolicyMirror({ skillRoot = SKILL_ROOT } = {}) {
  const tools = resolveDesignPolicyTools(skillRoot);
  if (!tools.ok) return { ok: false, problems: tools.problems };
  const designPath = resolve(skillRoot, 'DESIGN.md');
  const generatedPath = resolve(skillRoot, 'assets/runtime/design-policy.generated.mjs');
  const runtimePath = resolve(skillRoot, 'assets/runtime/ews-screen-runtime.mjs');
  if (!existsSync(designPath)) return { ok: false, problems: ['缺少 DESIGN.md'] };
  if (!existsSync(generatedPath)) return { ok: false, problems: ['缺少 assets/runtime/design-policy.generated.mjs'] };
  if (!existsSync(runtimePath)) return { ok: false, problems: ['缺少 assets/runtime/ews-screen-runtime.mjs'] };

  const { parseDesignPolicyFile } = await import(pathToFileURL(tools.parsePath).href);
  const { mirrorDesignPolicy } = await import(pathToFileURL(tools.mirrorPath).href);
  let policy;
  try {
    policy = parseDesignPolicyFile(designPath);
  } catch (err) {
    return { ok: false, problems: [err.message] };
  }

  const generatedMod = await import(`${pathToFileURL(generatedPath).href}?t=${Date.now()}`);
  const runtimeMod = await import(`${pathToFileURL(runtimePath).href}?t=${Date.now()}`);
  const runtimeSource = readFileSync(runtimePath, 'utf8');
  const generatedSource = readFileSync(generatedPath, 'utf8');
  const live = ewsImplementationFromRuntime({
    runtime: runtimeMod,
    runtimeSource,
    generated: generatedMod.DESIGN_POLICY,
  });
  if (!live.ok) return live;

  if (JSON.stringify(sixFields(policy)) !== JSON.stringify(sixFields(generatedMod.DESIGN_POLICY))) {
    return { ok: false, problems: ['generated snapshot 与 DESIGN.md 不一致'] };
  }

  try {
    const result = mirrorDesignPolicy({
      policy,
      implementation: live.snapshot,
      path: designPath,
    });
    return {
      ok: true,
      schema: result.schema,
      designHash: sha256(readFileSync(designPath)),
      generatedHash: sha256(generatedSource),
      runtimeHash: sha256(runtimeSource),
      values: live.snapshot,
    };
  } catch (err) {
    return { ok: false, problems: err.problems || [err.message] };
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runPolicyMirror();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
