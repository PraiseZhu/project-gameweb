import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFilesAtomically } from '../../figma-naming/tool/src/atomic-writeback.mjs';
import { canonicalJson } from './canonical.mjs';
import { StoppedError } from './stopped.mjs';

export function projectConfigPath(runRoot, fileKey, nodeId) {
  const key8 = String(fileKey).slice(0, 8);
  const node = String(nodeId).replace(/:/g, '-');
  return join(runRoot, 'projects', `${key8}-${node}`, 'config.json');
}

export function loadProjectConfig(runRoot, fileKey, nodeId) {
  const full = projectConfigPath(runRoot, fileKey, nodeId);
  if (!existsSync(full)) return { config: {}, path: full, existed: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(full, 'utf8'));
  } catch {
    throw new StoppedError(
      'config-invalid',
      `项目配置不是合法 JSON：${full}。不存在才按空配置运行，坏文件不能当成空配置。`,
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StoppedError(
      'config-invalid',
      `项目配置必须是 JSON 对象：${full}。`,
    );
  }
  return { config: raw, path: full, existed: true };
}

/** 原子写入项目配置。记录文件用 canonical JSON，避免键序漂移。 */
export function writeProjectConfigAtomic(filePath, config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new StoppedError('config-invalid', '项目配置必须是 JSON 对象。');
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFilesAtomically([[filePath, `${canonicalJson(config)}\n`]]);
}
