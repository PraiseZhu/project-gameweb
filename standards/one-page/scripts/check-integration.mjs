import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(packageRoot, '../..');
const expectedSources = [
  ['premises', 'docs/web-page-spec/README.md', '已拍板的前提（2026-11-11）'],
  ['fixed', 'docs/web-page-spec/html-standard-checklist.md', null],
  ['workflow', 'docs/web-page-spec/gameweb-workflow-discussion.md', null],
  ['materials', 'docs/web-page-spec/developer-handoff.md', null],
];
const hash = (text) => createHash('sha256').update(text).digest('hex');
const readText = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

function sourceUnits(text, selectionHeading) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const start = selectionHeading
    ? lines.findIndex((line) => line.trimEnd() === '## ' + selectionHeading)
    : 0;
  assert.ok(start >= 0, '来源缺少已拍板前提');
  let stop = lines.length;
  if (selectionHeading) {
    const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    if (next >= 0) stop = next;
  }
  const starts = [];
  for (let index = start; index < stop; index += 1) {
    if (/^#{1,5} /.test(lines[index])) starts.push(index);
  }
  if (starts[0] !== start) starts.unshift(start);
  starts.push(stop);
  return starts.slice(0, -1).map((from, index) => ({
    startLine: from + 1,
    endLine: starts[index + 1],
    raw: lines.slice(from, starts[index + 1]).join('').replace(/^\n+|\n+$/g, ''),
  }));
}

function permittedRendering(raw, sourcePath) {
  return raw.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (whole, label, href) => {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('#') || href.startsWith('/')) return whole;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), href));
    return '[' + label + '](' + path.posix.relative('standards/one-page', target) + ')';
  }).replace(/^(#{1,5}) /gm, (_, heading) => '#'.repeat(Math.max(3, heading.length + 1)) + ' ');
}

export function checkIntegration({ document, sourceMap, readSource } = {}) {
  const text = document ?? readText(path.join(packageRoot, 'delivery-and-acceptance.md'));
  const map = sourceMap ?? JSON.parse(readText(path.join(packageRoot, 'source-map.json')));
  const getSource = readSource ?? ((relative) => readText(path.join(repoRoot, relative)));
  assert.equal(map.schema, 'one-page/source-integration/v1');
  assert.deepEqual(map.sources.map((source) => [source.id, source.path, source.selectionHeading]), expectedSources,
    '三份全文来源与已拍板前提不得删减或替换');

  const expectedIds = [];
  for (const source of map.sources) {
    const original = getSource(source.path);
    assert.equal(hash(original), source.sha256, '来源已变化，须重新对账：' + source.path);
    const units = sourceUnits(original, source.selectionHeading);
    assert.equal(source.units.length, units.length, '来源段落对账表不完整：' + source.path);
    for (const [index, unit] of units.entries()) {
      const id = source.id + '-' + String(index + 1).padStart(3, '0');
      const record = source.units[index];
      expectedIds.push(id);
      assert.equal(record.id, id);
      assert.equal(record.startLine, unit.startLine);
      assert.equal(record.endLine, unit.endLine);
      assert.equal(record.sourceSha256, hash(unit.raw), '来源段内容已漂移：' + id);
      const expected = permittedRendering(unit.raw, source.path);
      assert.equal(record.renderedSha256, hash(expected), '对账表的正文摘要不匹配：' + id);
      const pattern = new RegExp('<!-- source-begin:' + id + ' -->\\n([\\s\\S]*?)\\n<!-- source-end:' + id + ' -->', 'g');
      const matches = [...text.matchAll(pattern)];
      assert.equal(matches.length, 1, '来源段缺失或重复：' + id);
      assert.equal(matches[0][1], expected, '来源正文被删减、改字或改变状态：' + id);
    }
  }
  const actualIds = [...text.matchAll(/<!-- source-begin:([a-z]+-\d{3}) -->/g)].map((match) => match[1]);
  assert.deepEqual(actualIds, expectedIds, '来源段的顺序或集合发生变化');
  const count = (pattern) => [...text.matchAll(pattern)].length;
  const counts = {
    H: count(/^\| H\d{2} \|/gm),
    F: count(/^#{3,6} F\d+ /gm),
    C: count(/^#{3,6} C\d+ /gm),
    D: count(/^#{3,6} D\d+ /gm),
    A: count(/^\| A\d{2} /gm),
  };
  assert.deepEqual(counts, { H: 43, F: 18, C: 5, D: 8, A: 12 });
  return { ok: true, sources: map.sources.length, completeDocuments: 3, sourceUnits: expectedIds.length, counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(checkIntegration(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write('整合校验失败：' + error.message + '\n');
    process.exitCode = 1;
  }
}
