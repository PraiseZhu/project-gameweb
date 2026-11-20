import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const documents = ['README.md', 'delivery-and-acceptance.md', 'source-reconciliation.md', 'task_plan.md', 'findings.md', 'progress.md'];

for (const name of documents) {
  test(name + ' 引用的本地规范与资料文件均存在且非空', () => {
    const document = new URL('../' + name, import.meta.url);
    const markdown = readFileSync(document, 'utf8');
    const links = [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((href) => !/^[a-z][a-z0-9+.-]*:/i.test(href));

    assert.ok(links.length > 0, '文档必须引用实际资料');
    for (const href of links) {
      const target = new URL(href, document);
      assert.ok(statSync(target).isFile(), '资料不是文件：' + href);
      const content = readFileSync(target, 'utf8');
      assert.ok(content.trim().length > 0, '资料为空：' + href);
      if (target.hash) {
        const anchor = decodeURIComponent(target.hash.slice(1));
        assert.ok(content.includes('<a id="' + anchor + '"></a>'), '锚点不存在：' + href);
      }
    }
  });
}
