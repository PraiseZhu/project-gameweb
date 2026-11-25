import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CONTRACT_VERSION,ACTIVE_PREFIXES,PARAM_NAMES,PARTS,CONFIG_KEYS } from '../../spec/onepage.mjs';
import { MOTIONS } from '../src/onepage/compile.mjs';

export function renderOnePageRules() {
  const lines=['# one-page 机器规则速查','',
    '由 npm run onepage:rules 生成，不手改。正式来源：[命名与绑定规范](../../spec/onepage-naming.md)。',
    '', '契约：'+CONTRACT_VERSION+'。旧 RULES.md 和在线命名速查仍属于旧契约。','',
    '| 前缀 | 职责 |','|---|---|',
    ...Object.entries(ACTIVE_PREFIXES).map(([k,v])=>'| '+k+'/ | '+v.desc+' |'),
    '', '参数：'+PARAM_NAMES.map(x=>'@'+x).join('、')+'。错挂、重复、冲突阻断。',
    '', 'part 枚举：'+PARTS.join('、')+'。',
    '', '配置顶层：'+CONFIG_KEYS.join('、')+'。fonts 可选；不写则与旧配置完全一致。meta 仅保存 B2 回答痕迹，编译器不解释。',
    '', 'fonts.faces 键为「中文字体名/字重」，值按 cn/tw/en/jp/kr 映射到 resources 资源名。',
    '', 'cards 分页 perPage 为正整数，或 {pc,mobile} 分端正整数；旧单值继续有效。',
    '', '外链只用 @link+links 或 bindings 的 open-link。devTodo 来源：figma:name:@link 或 config.bindings:action。url 为 null 才写入；缺 url 字段不建动作。节点诊断带 section（无所属屏为 null）。',
    '', '| 动效引用 | 标准 | 对象 | 单元 | 触发 |','|---|---|---|---|---|',
    ...Object.entries(MOTIONS).map(([k,v])=>'| '+[k,v.standard,v.roles.join('/'),v.units.join('/'),v.triggers.join('/')].join(' | ')+' |'),
    '', '这里只记录消费合同，不表示已完成页面生成、实际导图或像素验收。',''];
  return lines.join(String.fromCharCode(10));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) writeFileSync(new URL('../docs/ONEPAGE-RULES.md',import.meta.url),renderOnePageRules());
