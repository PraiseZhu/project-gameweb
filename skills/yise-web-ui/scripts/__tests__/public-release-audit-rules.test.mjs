import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderAbsolutePath } from '../lib/public-release-audit-rules.mjs';

test('release audit allows documented Windows placeholder paths only', () => {
  assert.equal(isPlaceholderAbsolutePath('C:\\path\\to\\project-gameweb'), true);
  assert.equal(isPlaceholderAbsolutePath('D:/your/project-gameweb'), true);
  assert.equal(isPlaceholderAbsolutePath('E:\\example\\repo'), true);
  assert.equal(isPlaceholderAbsolutePath('C:\\Users\\XINDONG\\Desktop\\project-gameweb'), false);
  assert.equal(isPlaceholderAbsolutePath('D:\\work\\real-project'), false);
  assert.equal(isPlaceholderAbsolutePath('/Users/example/project'), false);
});
