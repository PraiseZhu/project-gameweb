import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { byteDigest, isDigest } from './handoff-check.mjs';
import { resolveFontFile } from './fonts-b2.mjs';

const same = (left,right) => canonicalJson(left) === canonicalJson(right);
const check = (condition,message) => { if (!condition) throw new Error(message); };
const comparable = (fonts) => ({ faces:fonts.faces,resources:Object.fromEntries(Object.entries(fonts.resources).map(([key,{ file,...details }]) => [key,details])) });
const alias = (digest) => 'type-' + digest.slice(0,16);
const descriptor = (format) => ({ otf:'opentype',ttf:'truetype' }[format] ?? format);

export function patchFonts({ previous, config, audit, configDir, delta, manifest, build, baseLanguage }) {
  const [dependency] = delta.affectedSharedDeps;
  check(delta.affectedSharedDeps.length === 1 && dependency.kind === 'fonts' && !delta.evidence.fileVersionChanged
    && delta.evidence.nodeChanges.length === 0 && previous.fonts && config.fonts
    && dependency.previousDigest === sha256Hex(comparable(previous.fonts)) && dependency.digest === sha256Hex(comparable(config.fonts)),
  '字体变动和当前源不匹配，或混有尚不能局部执行的变化');
  const { digest,...body } = audit;
  check(digest === sha256Hex(body) && (audit.b1Version === null || audit.b1Version === delta.currentInputs.b1Version) && audit.baseLanguage === baseLanguage
    && !audit.problems.length, '现行字体核验结论无效');
  const root = join(build,'page');
  const stylesheet = join(root,'css/styles.css');
  let css = readFileSync(stylesheet,'utf8');
  const evidence = [];
  const next = manifest.fonts.map((old) => {
    const faces = old.faces.map((key) => audit.faces.find((face) => face.key === key)?.langs[baseLanguage]);
    const info = faces[0];
    check(info && isDigest(info.digest) && faces.every((row) => row?.digest === info.digest && row.resource === info.resource), '字体分组变化，不能安全替换现有字族');
    const resource = config.fonts.resources[info.resource];
    const located = resolveFontFile(resource,configDir);
    check(located.ok && ['otf','ttf','woff','woff2'].includes(resource.format) && typeof resource.license === 'string' && resource.license.trim(), '缺合规字体原件和许可');
    const bytes = readFileSync(located.path);
    check(byteDigest(bytes) === info.digest, '现行字体文件在核验后变化');
    const path = 'css/font/' + info.digest + '.' + resource.format;
    const licenseBytes = Buffer.from(resource.license);
    const font = { ...old, path, bytes:bytes.length, sha256:info.digest, source:resource.source,
      license:{ path:path + '.license.txt',bytes:licenseBytes.length,sha256:byteDigest(licenseBytes) } };
    if (same(old,font)) return old;
    evidence.push({ previous:old,next:font });
    const oldFormat = old.path.split('.').at(-1);
    const src = 'url("' + old.path.slice(4) + '") format("' + descriptor(oldFormat) + '")';
    check(css.includes(src) && css.includes(alias(old.sha256)), '旧字体样式锚点不符');
    css = css.replaceAll(src,'url("' + path.slice(4) + '") format("' + descriptor(resource.format) + '")')
      .replaceAll(alias(old.sha256),alias(info.digest));
    if (path !== old.path) {
      writeFileSync(join(root,path),bytes,{ flag:'wx' });
      rmSync(join(root,old.path));
      rmSync(join(root,old.license.path));
    }
    writeFileSync(join(root,font.license.path),licenseBytes);
    return font;
  });
  check(evidence.length, '源字体变化不影响本基础语言的现有字体');
  manifest.fonts = next;
  writeFileSync(stylesheet,css);
  return { sourceDigest:delta.currentInputs.fontsDigest, changes:evidence };
}

export function verifyFontProof(manifest,delta,proof) {
  check(proof.sourceDigest === delta.currentInputs.fontsDigest && proof.changes.length
    && proof.changes.every(({ previous,next }) => previous.language === next.language && same(previous.faces,next.faces)
      && manifest.fonts.filter((font) => same(font,next)).length === 1), 'C4 字体与已绑定来源追溯不符');
}
