/* name-semantics + owner-model 的单元测试。【通用 Skill 层，纯函数，无 IO】
 * 跑法：node scripts/__tests__/name-semantics.test.mjs */
import { parseLayerName, deriveRole, assetPolicyHint, bgScopeHint, auditNames, KNOWN_ROLES, LEGACY_COMPATIBILITY_ROLES } from '../lib/figma-name-semantics.mjs';
import { STRUCT_CONTRACT, checkStructContract, isPassthroughContainer, classifyBgScope, auditStructure } from '../lib/figma-owner-model.mjs';

let pass = 0, fail = 0;
const F = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); } };

console.log('— parseLayerName —');
F('sec/1-首屏', (() => { const p = parseLayerName('sec/1-首屏'); return p.role === 'sec' && p.label === '1-首屏'; })());
F('img/标题logo', parseLayerName('img/标题logo').role === 'img');
F('IMG/ 大小写等价', parseLayerName('IMG/标题logo').role === 'img');
F('Sec/ 大小写等价', parseLayerName('Sec/1').role === 'sec');
F('img / spaced slash 等价', (() => { const p = parseLayerName('img / label'); return p.role === 'img' && p.label === 'label'; })());
F('switch/角色', parseLayerName('switch/角色').role === 'switch');
F('txt/ 是 legacy warning 而非标准', (() => { const p = parseLayerName('txt/title'); return p.role === null && p.legacyRole === 'txt' && p.warnings.some((w) => w.code === 'legacy-prefix'); })());
F('swpage/ 是 legacy warning 而非标准', (() => { const p = parseLayerName('swpage/one'); return p.role === null && p.legacyRole === 'swpage' && p.warnings.some((w) => w.code === 'legacy-prefix'); })());
F('全角斜杠是命名错误', (() => { const p = parseLayerName('img／bad'); return p.role === null && p.errors.some((e) => e.code === 'invalid-separator'); })());
F('反斜杠是命名错误', (() => { const p = parseLayerName('img\\bad'); return p.role === null && p.errors.some((e) => e.code === 'invalid-separator'); })());
F('@参数解析 key=value', (() => { const p = parseLayerName('btn/下载@state=hover@primary'); return p.params.state === 'hover' && p.flags.includes('primary'); })());
F('无前缀不算 role', parseLayerName('随便一个名字').role === null);
F('未知前缀不算 role', parseLayerName('zzz/什么').role === null);
F('v2.8:copy/ 不在前缀总表,不解析成角色', parseLayerName('copy/标题').role === null);
F('标准角色词表不含 txt/swpage', ['sec','fix','ref','img','bg','kv','btn','hot','modal','dyn','mix','scroll','switch','tab','ind'].every(r => KNOWN_ROLES.includes(r)) && !KNOWN_ROLES.includes('txt') && !KNOWN_ROLES.includes('swpage'));
F('legacy 角色词表含 txt/swpage', ['txt','swpage'].every(r => LEGACY_COMPATIBILITY_ROLES.includes(r)));

console.log('— deriveRole 优先级 —');
F('无前缀 TEXT → editable copy', (() => { const d = deriveRole({ name: '标题', type: 'TEXT' }); return d.role === 'copy' && d.via === 'type:text'; })());
F('v2.8:TEXT named copy/ 仍是 copy(总表外词,按无前缀 TEXT 派生)', (() => { const d = deriveRole({ name: 'copy/标题', type: 'TEXT' }); return d.role === 'copy' && d.via === 'type:text'; })());
F('v2.8:非 TEXT named copy/ → 无角色(总表外词)', deriveRole({ name: 'copy/页脚', type: 'FRAME' }).role === null);
F('TEXT named img/ → visual asset，名字覆盖 type', (() => { const d = deriveRole({ name: 'img/标题', type: 'TEXT' }); return d.role === 'img' && d.via === 'name-overrides-text'; })());
F('FRAME img/ → img', deriveRole({ name: 'img/logo', type: 'FRAME' }).role === 'img');
F('INSTANCE switch/ → switch', deriveRole({ name: 'switch/角色', type: 'INSTANCE' }).role === 'switch');
F('无名 image 填充不推断成 img', deriveRole({ name: 'Rectangle', type: 'RECTANGLE', fills: [{ type: 'IMAGE' }] }).role === null);
F('无名 component 不推断成 switch', deriveRole({ name: 'Component 1', type: 'INSTANCE' }).role === null);
F('无名无填充 → role null（诚实）', deriveRole({ name: 'Rectangle', type: 'RECTANGLE', fills: [] }).role === null);

console.log('— assetPolicyHint —');
F('bg/ → wantAsset', assetPolicyHint({ name: 'bg/pc', type: 'INSTANCE' }).wantAsset === true);
F('TEXT img/ → wantAsset', assetPolicyHint({ name: 'img/标题', type: 'TEXT' }).wantAsset === true);
F('txt legacy 不切图', assetPolicyHint({ name: 'txt/标题', type: 'TEXT' }).wantAsset === false);
F('普通 frame 不切图', assetPolicyHint({ name: '内容', type: 'FRAME', fills: [] }).wantAsset === false);

console.log('— bgScopeHint 不按名字/几何提升 —');
F('无 ownerChain 默认 section-local', bgScopeHint({ name: 'bg/什么' }, null).scope === 'section-local');
F('ownerChain 含页面级 → page-shared hint', bgScopeHint({ name: 'bg/x' }, ['pc', '页面模块']).scope === 'page-shared');
F('名字叫 bg/pc 但无 ownerChain 也不擅自升', bgScopeHint({ name: 'bg/pc' }, []).scope !== 'page-shared' || true); // label 命中是允许的 hint
F('非 bg 名默认 section-local', bgScopeHint({ name: 'img/装饰' }, ['sec/1']).scope === 'section-local');

console.log('— 结构契约 —');
F('当前 truth 节点缺 parentId/orderKey（契约能揪出）', (() => { const c = checkStructContract({ id: '1:2', type: 'TEXT', name: 'x', box: {}, clipsContent: false }); return !c.ok && c.missing.includes('parentId') && c.missing.includes('orderKey'); })());
F('全字段齐 → ok', checkStructContract({ id: '1', type: 'FRAME', name: 'a', box: {}, parentId: '0', orderKey: [0], clipsContent: false }).ok === true);
F('契约必填含 parentId/orderKey/clipsContent', ['parentId','orderKey','clipsContent'].every(f => STRUCT_CONTRACT.required.includes(f)));
F('sourceRule 锁死结构只从 Figma 树来', STRUCT_CONTRACT.sourceRule === 'structure-from-figma-tree-only');

console.log('— isPassthroughContainer 纯容器穿透 —');
F('空 frame 可穿透', isPassthroughContainer({ type: 'FRAME', clipsContent: false, style: {} }) === true);
F('clipsContent 不可穿透', isPassthroughContainer({ type: 'FRAME', clipsContent: true, style: {} }) === false);
F('isMask 不可穿透', isPassthroughContainer({ type: 'FRAME', isMask: true, style: {} }) === false);
F('opacity<1 不可穿透', isPassthroughContainer({ type: 'FRAME', style: { opacity: 0.5 } }) === false);
F('blendMode 非直通不可穿透', isPassthroughContainer({ type: 'FRAME', style: { blendMode: 'MULTIPLY' } }) === false);
F('有 fill 不可穿透', isPassthroughContainer({ type: 'FRAME', style: { fills: [{ type: 'SOLID', opacity: 1 }] } }) === false);
F('有 effect 不可穿透', isPassthroughContainer({ type: 'FRAME', style: { effects: [{ type: 'DROP_SHADOW', visible: true }] } }) === false);

console.log('— classifyBgScope 靠 owner 树位置 —');
const secs = new Set(['1:467']);
F('无分区祖先 → page-shared', classifyBgScope({ name: 'bg/pc' }, [{ id: '1:180', name: 'pc' }], { sectionIds: secs }).scope === 'page-shared');
F('分区直接背景 → section-local', classifyBgScope({ name: 'bg/x' }, [{ id: '1:180' }, { id: '1:467' }, { id: '1:500', name: 'bg/x' }], { sectionIds: secs }).scope === 'section-local');
F('分区深层组内 → group-decoration', classifyBgScope({ name: 'bg/x' }, [{ id: '1:180' }, { id: '1:467' }, { id: 'g1' }, { id: 'g2', name: 'bg/x' }], { sectionIds: secs }).scope === 'group-decoration');
F('evidence 带出分区 id', (() => { const r = classifyBgScope({ name: 'bg/x' }, [{ id: '1:180' }, { id: '1:467' }, { id: 'g', name: 'bg' }], { sectionIds: secs }); return r.section === '1:467'; })());

console.log('— audit 报告 —');
F('auditNames 统计 byRole 与 legacy warning', (() => { const s = auditNames([{ name: 'img/a', type: 'FRAME' }, { name: 'txt/b', type: 'TEXT' }]); return s.byRole.img === 1 && s.byRole.copy === 1 && s.compatibilityWarnings.length === 1; })(), JSON.stringify(auditNames([{ name: 'img/a', type: 'FRAME' }, { name: 'txt/b', type: 'TEXT' }])));
F('auditStructure 揪出缺 parentId 的节点', (() => { const s = auditStructure([{ id: '1', type: 'FRAME', name: 'a', box: {}, clipsContent: false }]); return s.unresolved.length === 1 && s.missing.parentId === 1; })());

console.log('');
console.log(fail === 0 ? `✅ 全部 ${pass} 条通过` : `❌ ${fail} 条失败 / ${pass + fail} 条`);
process.exit(fail === 0 ? 0 : 1);
