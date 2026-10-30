import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEwsWeb } from '../../ews-web.mjs';
import {
  defaultConfig, defaultDesignations, makeLark, writeAssets, writeReadyPack,
} from './ready-fixture.mjs';

export function tmpDir(name) {
  return mkdtempSync(join(tmpdir(), name));
}

export function buildSyntheticDemo(name = 'ews-demo-', extra = {}) {
  const root = tmpDir(name);
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  const configPath = join(root, 'config.json');
  writeFileSync(configPath, `${JSON.stringify({ ...defaultConfig(docs), ...(extra.config || {}) }, null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', configPath,
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
    ...(extra.args || []),
  ], { cwd: root });
  if (!built.ok) throw new Error((built.problems || []).join('\n'));
  return {
    root,
    handoff,
    assetsDir,
    assetsPath: join(assetsDir, 'asset-map.json'),
    configPath,
    out,
    docs,
  };
}
