#!/usr/bin/env node
/**
 * Fail-closed parser for DESIGN.md YAML front matter.
 * Schema: gameweb-design-policy/v1
 *
 * Illegal YAML (bare #, Tab, duplicate keys, unregistered keys, missing
 * required keys) throws. No silent defaults.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SCHEMA = 'gameweb-design-policy/v1';

export const REGISTERED_KEYS = Object.freeze([
  'schema',
  'designWidths',
  'officialRootFontVw',
  'heroViewportFillVh',
  'composition',
  'qaBuckets',
  'inventPadTree',
  'padUsesPcTree',
  'localeFontScale',
  'tierRules',
  'shrinkSteps',
  'shrinkFloorPercent',
  'hugNoShrink',
  'openFlowNoShrink',
  'shrinkMode',
  'modalViewportFill',
  'modalScrimOpacity',
  'modalLockPageScroll',
]);

const OPTIONAL_KEYS = Object.freeze([
  'shrinkMode',
  'modalViewportFill',
  'modalScrimOpacity',
  'modalLockPageScroll',
]);
const REQUIRED_KEYS = Object.freeze(REGISTERED_KEYS.filter((key) => !OPTIONAL_KEYS.includes(key)));

function fail(message) {
  const err = new Error(message);
  err.code = 'DESIGN_POLICY_PARSE';
  throw err;
}

const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function emptyMap() {
  return Object.create(null);
}

function hasOwn(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

function assertSafeKey(key, at) {
  if (FORBIDDEN_KEYS.includes(key)) fail(`forbidden key: ${key}${at ? ` at ${at}` : ''}`);
}

function splitFrontMatter(markdown) {
  const src = String(markdown ?? '');
  if (!src.startsWith('---\n') && !src.startsWith('---\r\n')) {
    fail('DESIGN.md must start with YAML front matter delimited by ---');
  }
  const rest = src.slice(src.startsWith('---\r\n') ? 5 : 4);
  const endLf = rest.indexOf('\n---');
  if (endLf < 0) fail('DESIGN.md YAML front matter is not closed by ---');
  const raw = rest.slice(0, endLf).replace(/\r\n/g, '\n');
  return raw;
}

function indentOf(line) {
  const match = /^( *)/.exec(line);
  return match ? match[1].length : 0;
}

function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (value.includes('#')) fail(`bare # is not allowed outside quotes: ${value}`);
  return value;
}

function parseBlock(lines, start, parentIndent) {
  const result = emptyMap();
  const seen = new Set();
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const indent = indentOf(line);
    if (indent < parentIndent) break;
    if (indent !== parentIndent) fail(`inconsistent indent at: ${line}`);
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    if (colon < 0) fail(`expected key: value at: ${trimmed}`);
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    if (!key) fail(`empty key at: ${trimmed}`);
    assertSafeKey(key, trimmed);
    if (seen.has(key)) fail(`duplicate key: ${key}`);
    seen.add(key);
    if (rest === '') {
      const next = lines[i + 1];
      if (!next || !next.trim() || indentOf(next) <= indent) {
        result[key] = emptyMap();
        i += 1;
        continue;
      }
      if (next.trim().startsWith('- ')) {
        const list = [];
        i += 1;
        while (i < lines.length) {
          const itemLine = lines[i];
          if (!itemLine.trim() || itemLine.trim().startsWith('#')) {
            i += 1;
            continue;
          }
          if (indentOf(itemLine) <= indent) break;
          const itemTrim = itemLine.trim();
          if (!itemTrim.startsWith('- ')) fail(`expected list item under ${key}: ${itemTrim}`);
          const body = itemTrim.slice(2);
          if (body.includes(':') && !body.startsWith('{')) {
            const nestedLines = [];
            const itemIndent = indentOf(itemLine);
            nestedLines.push(`${' '.repeat(itemIndent + 2)}${body}`);
            i += 1;
            while (i < lines.length) {
              const nested = lines[i];
              if (!nested.trim()) {
                i += 1;
                continue;
              }
              if (indentOf(nested) <= itemIndent) break;
              nestedLines.push(nested);
              i += 1;
            }
            list.push(parseBlock(nestedLines, 0, itemIndent + 2).value);
            continue;
          }
          list.push(parseScalar(body));
          i += 1;
        }
        result[key] = list;
        continue;
      }
      const nested = parseBlock(lines, i + 1, indent + 2);
      result[key] = nested.value;
      i = nested.index;
      continue;
    }
    result[key] = parseScalar(rest);
    i += 1;
  }
  return { value: result, index: i };
}

function parseYamlMapping(raw) {
  if (String(raw).includes('\t')) fail('Tab characters are not allowed in DESIGN.md YAML');
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (/^\s*#/.test(line) || /['"].*#.*['"]/.test(line) || !line.includes('#')) continue;
    const beforeHash = line.split('#')[0];
    const isKeyOnly = beforeHash.trim() === `${beforeHash.trim().split(':')[0]}:`;
    if (beforeHash.includes(':') && !isKeyOnly) fail(`bare # is not allowed: ${line}`);
  }
  return parseBlock(lines, 0, 0).value;
}

function assertNumber(name, value, { integer = false, min = null } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a finite number`);
  if (integer && !Number.isInteger(value)) fail(`${name} must be an integer`);
  if (min != null && value < min) fail(`${name} must be >= ${min}`);
  return value;
}

function assertBool(name, value) {
  if (typeof value !== 'boolean') fail(`${name} must be a boolean`);
  return value;
}

function assertBreakpoints(name, list) {
  if (!Array.isArray(list) || !list.length) fail(`${name} must be a non-empty list`);
  return list.map((item, index) => {
    if (!isPlainObject(item)) fail(`${name}[${index}] must be a mapping`);
    const extra = Object.keys(item).filter((key) => !['key', 'min', 'max'].includes(key));
    if (extra.length) fail(`${name}[${index}] has unregistered keys: ${extra.join(', ')}`);
    if (typeof item.key !== 'string' || !item.key) fail(`${name}[${index}].key is required`);
    assertNumber(`${name}[${index}].min`, item.min, { integer: true, min: 0 });
    const max = item.max == null ? null : assertNumber(`${name}[${index}].max`, item.max, { integer: true, min: 0 });
    return Object.freeze({ key: item.key, min: item.min, max });
  });
}

function assertLocaleFontScale(value) {
  if (!isPlainObject(value)) fail('localeFontScale must be a mapping');
  const tiers = ['body', 'card-title', 'heading'];
  const langs = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];
  const extraTiers = Object.keys(value).filter((key) => !tiers.includes(key));
  if (extraTiers.length) fail(`localeFontScale has unregistered tiers: ${extraTiers.join(', ')}`);
  const out = {};
  for (const tier of tiers) {
    const row = value[tier];
    if (!isPlainObject(row)) fail(`localeFontScale.${tier} must be a mapping`);
    const extraLangs = Object.keys(row).filter((key) => !langs.includes(key));
    if (extraLangs.length) fail(`localeFontScale.${tier} has unregistered langs: ${extraLangs.join(', ')}`);
    const next = {};
    for (const lang of langs) {
      if (!hasOwn(row, lang)) fail(`localeFontScale.${tier}.${lang} is required`);
      assertNumber(`localeFontScale.${tier}.${lang}`, row[lang]);
      next[lang] = row[lang];
    }
    out[tier] = Object.freeze(next);
  }
  return Object.freeze(out);
}

function assertTierRules(value) {
  if (!isPlainObject(value)) fail('tierRules must be a mapping');
  const extra = Object.keys(value).filter((key) => !['bodyMaxWeightExclusive', 'cardTitleMinSourcePxExclusive'].includes(key));
  if (extra.length) fail(`tierRules has unregistered keys: ${extra.join(', ')}`);
  assertNumber('tierRules.bodyMaxWeightExclusive', value.bodyMaxWeightExclusive, { integer: true, min: 1 });
  assertNumber('tierRules.cardTitleMinSourcePxExclusive', value.cardTitleMinSourcePxExclusive, { min: 0 });
  return Object.freeze({
    bodyMaxWeightExclusive: value.bodyMaxWeightExclusive,
    cardTitleMinSourcePxExclusive: value.cardTitleMinSourcePxExclusive,
  });
}

export function parseDesignPolicyMarkdown(markdown, { path = 'DESIGN.md' } = {}) {
  const raw = splitFrontMatter(markdown);
  const doc = parseYamlMapping(raw);
  const extra = Object.keys(doc).filter((key) => !REGISTERED_KEYS.includes(key));
  if (extra.length) fail(`unregistered key: ${extra.join(', ')}`);
  for (const key of REQUIRED_KEYS) {
    if (!hasOwn(doc, key)) fail(`missing required key: ${key}`);
  }
  if (doc.schema !== SCHEMA) fail(`schema must be ${SCHEMA}, got ${doc.schema}`);
  if (!isPlainObject(doc.designWidths)) fail('designWidths must be a mapping');
  const widthExtra = Object.keys(doc.designWidths).filter((key) => !['mobile', 'pad', 'pc'].includes(key));
  if (widthExtra.length) fail(`designWidths has unregistered keys: ${widthExtra.join(', ')}`);
  for (const key of ['mobile', 'pad', 'pc']) {
    if (!hasOwn(doc.designWidths, key)) fail(`designWidths.${key} is required`);
    assertNumber(`designWidths.${key}`, doc.designWidths[key], { integer: true, min: 1 });
  }
  const shrinkMode = hasOwn(doc, 'shrinkMode') ? String(doc.shrinkMode) : 'percent-ladder';
  if (shrinkMode !== 'percent-ladder' && shrinkMode !== 'integer-px') {
    fail(`shrinkMode must be percent-ladder or integer-px, got ${shrinkMode}`);
  }
  if (!Array.isArray(doc.shrinkSteps)) fail('shrinkSteps must be a list');
  const shrinkSteps = doc.shrinkSteps.map((step, index) => {
    assertNumber(`shrinkSteps[${index}]`, step, { integer: true, min: 1 });
    return step;
  });
  if (!shrinkSteps.length) fail('shrinkSteps must be a non-empty list');
  const floor = assertNumber('shrinkFloorPercent', doc.shrinkFloorPercent, { integer: true, min: 1 });
  if (shrinkMode === 'percent-ladder' && Math.min(...shrinkSteps) !== floor) {
    fail(`shrinkSteps floor ${Math.min(...shrinkSteps)} must equal shrinkFloorPercent ${floor}`);
  }
  if (shrinkMode === 'integer-px') {
    if (shrinkSteps.length !== 1 || shrinkSteps[0] !== 1) {
      fail('integer-px shrinkMode requires shrinkSteps: [1]');
    }
    if (floor !== 1) fail('integer-px shrinkMode requires shrinkFloorPercent: 1');
  }
  return Object.freeze({
    schema: SCHEMA,
    path,
    designWidths: Object.freeze({
      mobile: doc.designWidths.mobile,
      pad: doc.designWidths.pad,
      pc: doc.designWidths.pc,
    }),
    officialRootFontVw: assertNumber('officialRootFontVw', doc.officialRootFontVw, { min: 0 }),
    heroViewportFillVh: assertNumber('heroViewportFillVh', doc.heroViewportFillVh, { min: 0 }),
    composition: Object.freeze(assertBreakpoints('composition', doc.composition)),
    qaBuckets: Object.freeze(assertBreakpoints('qaBuckets', doc.qaBuckets)),
    inventPadTree: assertBool('inventPadTree', doc.inventPadTree),
    padUsesPcTree: assertBool('padUsesPcTree', doc.padUsesPcTree),
    localeFontScale: assertLocaleFontScale(doc.localeFontScale),
    tierRules: assertTierRules(doc.tierRules),
    shrinkSteps: Object.freeze([...shrinkSteps]),
    shrinkFloorPercent: floor,
    hugNoShrink: assertBool('hugNoShrink', doc.hugNoShrink),
    openFlowNoShrink: assertBool('openFlowNoShrink', doc.openFlowNoShrink),
    shrinkMode,
    ...assertOptionalModalPolicy(doc),
  });
}

function assertOptionalModalPolicy(doc) {
  const hasFill = hasOwn(doc, 'modalViewportFill');
  const hasScrim = hasOwn(doc, 'modalScrimOpacity');
  const hasLock = hasOwn(doc, 'modalLockPageScroll');
  if (!hasFill && !hasScrim && !hasLock) return {};
  if (!hasFill || !hasScrim || !hasLock) {
    fail('modalViewportFill, modalScrimOpacity, and modalLockPageScroll must be declared together');
  }
  const fill = String(doc.modalViewportFill);
  if (fill !== 'cover' && fill !== 'contain') {
    fail(`modalViewportFill must be cover or contain, got ${fill}`);
  }
  const scrim = assertNumber('modalScrimOpacity', doc.modalScrimOpacity, { min: 0 });
  if (scrim > 1) fail('modalScrimOpacity must be <= 1');
  return {
    modalViewportFill: fill,
    modalScrimOpacity: scrim,
    modalLockPageScroll: assertBool('modalLockPageScroll', doc.modalLockPageScroll),
  };
}

export function parseDesignPolicyFile(filePath) {
  const abs = resolve(filePath);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    fail(`cannot read DESIGN.md: ${abs}: ${err && err.message ? err.message : err}`);
  }
  return parseDesignPolicyMarkdown(text, { path: abs });
}

function isCli() {
  const self = process.argv[1] ? resolve(process.argv[1]) : '';
  return self.endsWith('parse-design-policy.mjs');
}

if (isCli()) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('usage: node src/parse-design-policy.mjs <DESIGN.md>\n');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(parseDesignPolicyFile(target), null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
