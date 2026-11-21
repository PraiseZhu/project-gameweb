import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkIntegration } from '../scripts/check-integration.mjs';

const document = readFileSync(new URL('../delivery-and-acceptance.md', import.meta.url), 'utf8');

test('三份来源全文与已拍板前提逐段完整纳入，数值和状态不变', () => {
  assert.equal(checkIntegration().ok, true);
});

test('删除未单独编号的组件接口细则也必须失败', () => {
  const line = document.split('\n').find((value) => value.includes('window.createSiteFooter'));
  assert.ok(line, '必须存在完整组件接口细则');
  assert.throws(() => checkIntegration({ document: document.replace(line, '') }), /来源正文被删减/);
});

test('偷偷改变动效参数必须失败', () => {
  assert.ok(document.includes('560ms'));
  assert.throws(() => checkIntegration({ document: document.replace('560ms', '561ms') }), /来源正文被删减/);
});

test('将待讨论方案升级为已定必须失败', () => {
  assert.ok(document.includes('**待讨论：**'));
  assert.throws(() => checkIntegration({ document: document.replace('**待讨论：**', '**已定：**') }), /来源正文被删减/);
});

test('从对账表移除整份资料要求不能伪装全覆盖', () => {
  const sourceMap = JSON.parse(readFileSync(new URL('../source-map.json', import.meta.url), 'utf8'));
  sourceMap.sources = sourceMap.sources.filter((source) => source.id !== 'materials');
  assert.throws(() => checkIntegration({ sourceMap }), /三份全文来源与已拍板前提不得删减/);
});

test('原始来源变化时阻断旧整合版的通过结论', () => {
  const readSource = (relative) => readFileSync(new URL('../../../' + relative, import.meta.url), 'utf8');
  assert.throws(() => checkIntegration({ readSource: (relative) => readSource(relative) + '\n来源已变动\n' }), /来源已变化/);
});
