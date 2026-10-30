import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDeclaredStructure } from '../lib/audit-declared-structure.mjs';

function img(id, assetKey, extra = {}) {
  return {
    id,
    type: extra.type || 'FRAME',
    name: extra.name || `img/[replaceable]${assetKey}`,
    status: 'determined',
    role: 'img',
    replaceable: true,
    assetKey,
    params: {},
    parentId: extra.parentId ?? null,
    ancestorIds: extra.ancestorIds || [],
    ...extra,
  };
}

function instance(id, componentId, ancestors = []) {
  return {
    id,
    type: 'INSTANCE',
    name: '卡片',
    status: 'unknown',
    componentId,
    parentId: ancestors.at(-1) ?? null,
    ancestorIds: ancestors,
  };
}

function dups(inv, key) {
  return auditDeclaredStructure(inv).problems.filter((item) => item.includes(`用途名「${key}」重复定义`));
}

test('EWS A12: master plus direct/nested instance refs are not duplicate defs', () => {
  const master = img('10:90', '视频图', { parentId: '10:80', ancestorIds: ['10:80'] });
  const inv = {
    nodes: [
      { id: 'sec', type: 'FRAME', name: 'sec/1', status: 'determined', role: 'sec', label: '1', params: {} },
      instance('10:55', '10:80', ['sec']),
      img('I10:55;10:90', '视频图', { parentId: '10:55', ancestorIds: ['sec', '10:55'] }),
      instance('10:56', '10:80', ['sec']),
      img('I10:56;10:90', '视频图', { parentId: '10:56', ancestorIds: ['sec', '10:56'] }),
      instance('10:300', '10:100', ['sec']),
      instance('I10:300;10:101', '10:80', ['sec', '10:300']),
      img('I10:300;10:101;10:90', '视频图', {
        parentId: 'I10:300;10:101',
        ancestorIds: ['sec', '10:300', 'I10:300;10:101'],
      }),
    ],
    attachments: {
      components: [
        { id: '10:80', nodes: [{ id: '10:80', type: 'COMPONENT', name: '视频板块', status: 'unknown' }, master] },
        { id: '10:100', nodes: [{ id: '10:100', type: 'COMPONENT', name: '外卡', status: 'unknown' }] },
      ],
    },
  };
  assert.equal(dups(inv, '视频图').length, 0, dups(inv, '视频图').join('\n'));
});

test('EWS A12: independent masters, unknown mapping, and instance-only override stay red', () => {
  const states = {
    nodes: [
      instance('20:10', '20:2', []),
      img('I20:10;20:3', '选手图', { parentId: '20:10', ancestorIds: ['20:10'] }),
      instance('20:11', '20:4', []),
      img('I20:11;20:5', '选手图', { parentId: '20:11', ancestorIds: ['20:11'] }),
    ],
    attachments: {
      componentSets: [{
        id: '20:1',
        nodes: [
          { id: '20:1', type: 'COMPONENT_SET', name: '角色选手卡片', status: 'unknown' },
          { id: '20:2', type: 'COMPONENT', name: 'Property 1=已有选手', status: 'unknown', parentId: '20:1', ancestorIds: ['20:1'] },
          img('20:3', '选手图', { parentId: '20:2', ancestorIds: ['20:1', '20:2'] }),
          { id: '20:4', type: 'COMPONENT', name: 'Property 1=待确定选手', status: 'unknown', parentId: '20:1', ancestorIds: ['20:1'] },
          img('20:5', '选手图', { parentId: '20:4', ancestorIds: ['20:1', '20:4'] }),
        ],
      }],
    },
  };
  const stateDups = dups(states, '选手图');
  assert.ok(stateDups.some((item) => item.startsWith('20:3 ')), stateDups.join('\n'));
  assert.ok(stateDups.some((item) => item.startsWith('20:5 ')), stateDups.join('\n'));

  const unknown = {
    nodes: [
      instance('10:55', '10:80', []),
      img('I10:55;missing:1', '视频图', { parentId: '10:55', ancestorIds: ['10:55'] }),
      img('I99:1;10:90', '视频图'),
    ],
    attachments: {
      components: [{
        id: '10:80',
        nodes: [
          { id: '10:80', type: 'COMPONENT', name: '视频板块', status: 'unknown' },
          img('10:90', '视频图', { parentId: '10:80', ancestorIds: ['10:80'] }),
        ],
      }],
    },
  };
  const unknownDups = dups(unknown, '视频图');
  assert.ok(unknownDups.some((item) => item.includes('I10:55;missing:1')), unknownDups.join('\n'));
  assert.ok(unknownDups.some((item) => item.includes('I99:1;10:90')), unknownDups.join('\n'));

  const override = {
    nodes: [
      instance('10:55', '10:80', []),
      img('I10:55;10:90', '视频图', { parentId: '10:55', ancestorIds: ['10:55'] }),
      instance('10:56', '10:80', []),
      img('I10:56;10:90', '视频图', { parentId: '10:56', ancestorIds: ['10:56'] }),
    ],
    attachments: {
      components: [{
        id: '10:80',
        nodes: [
          { id: '10:80', type: 'COMPONENT', name: '视频板块', status: 'unknown' },
          {
            id: '10:90',
            type: 'FRAME',
            name: 'img/视频图',
            status: 'determined',
            role: 'img',
            params: {},
            parentId: '10:80',
            ancestorIds: ['10:80'],
          },
        ],
      }],
    },
  };
  const overrideDups = dups(override, '视频图');
  assert.ok(overrideDups.some((item) => item.includes('I10:55;10:90')), overrideDups.join('\n'));
  assert.ok(overrideDups.some((item) => item.includes('I10:56;10:90')), overrideDups.join('\n'));
});

test('EWS A12: legal img+lang set still collapses', () => {
  const inv = {
    nodes: [
      instance('hero', 'v-cn', []),
    ],
    attachments: {
      componentSets: [{
        id: 'lang-set',
        nodes: [
          {
            id: 'lang-set',
            type: 'COMPONENT_SET',
            name: 'img/[replaceable]模块2玩法截图',
            status: 'determined',
            role: 'img',
            replaceable: true,
            assetKey: '模块2玩法截图',
            params: {},
          },
          {
            id: 'v-cn',
            type: 'COMPONENT',
            name: 'lang=cn',
            status: 'determined',
            role: 'img',
            replaceable: true,
            assetKey: '模块2玩法截图',
            params: {},
            parentId: 'lang-set',
            ancestorIds: ['lang-set'],
          },
          {
            id: 'v-tw',
            type: 'COMPONENT',
            name: 'lang=tw',
            status: 'determined',
            role: 'img',
            replaceable: true,
            assetKey: '模块2玩法截图',
            params: {},
            parentId: 'lang-set',
            ancestorIds: ['lang-set'],
          },
        ],
      }],
    },
  };
  assert.equal(dups(inv, '模块2玩法截图').length, 0, dups(inv, '模块2玩法截图').join('\n'));
});
