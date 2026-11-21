import { token } from '../../figma-naming/tool/src/figma.mjs';
import { StoppedError } from './stopped.mjs';

const API = 'https://api.figma.com';
export const DEFAULT_TIMEOUT_MS = 20_000;

function readToken(tokenValue) {
  if (tokenValue != null && String(tokenValue) !== '') {
    const value = String(tokenValue);
    if (/^figd_x+$/.test(value)) {
      throw new StoppedError(
        'token-missing',
        '未配置 FIGMA_ACCESS_TOKEN。请在 standards/figma-naming/tool/.env 写入有效 token 后重试。',
      );
    }
    return value;
  }
  try {
    return token();
  } catch {
    throw new StoppedError(
      'token-missing',
      '未配置 FIGMA_ACCESS_TOKEN。请在 standards/figma-naming/tool/.env 写入有效 token 后重试。',
    );
  }
}

function abortError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    const fail = () => reject(abortError());
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
}

async function readJson(res, signal) {
  return Promise.race([res.json(), waitForAbort(signal)]);
}

async function figmaGet(path, { fetchImpl, timeoutMs, tokenValue }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(`${API}${path}`, {
        headers: { 'X-Figma-Token': tokenValue },
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted || err?.name === 'AbortError') {
        throw new StoppedError('timeout', '访问 Figma 网络超时。请检查网络后重试。');
      }
      throw new StoppedError('network', '无法连接 Figma。请检查网络后重试。');
    }

    if (res.status === 401) {
      throw new StoppedError(
        'http-401',
        'Figma token 已过期或无效。请到 Figma 重新生成 Personal Access Token，写入 standards/figma-naming/tool/.env 的 FIGMA_ACCESS_TOKEN 后重试。',
      );
    }
    if (res.status === 403) {
      throw new StoppedError(
        'http-403',
        '当前 token 对该文件没有权限。请让文件所有者开通访问，或更换有权限的 token 后重试。',
      );
    }
    if (res.status === 404) {
      throw new StoppedError(
        'http-404',
        'Figma 文件或节点不存在。请核对链接里的 fileKey 与 node-id 是否仍有效。',
      );
    }
    if (!res.ok) {
      throw new StoppedError(
        `http-${res.status}`,
        `访问 Figma 失败（HTTP ${res.status}）。请稍后重试。`,
      );
    }

    try {
      return await readJson(res, ac.signal);
    } catch (err) {
      if (ac.signal.aborted || err?.name === 'AbortError') {
        throw new StoppedError('timeout', '访问 Figma 网络超时。请检查网络后重试。');
      }
      throw new StoppedError('network', '无法连接 Figma。请检查网络后重试。');
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function probeFigmaPage({
  fileKey,
  nodeId,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenValue,
} = {}) {
  const secret = readToken(tokenValue);
  const path = `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`;
  const data = await figmaGet(path, { fetchImpl, timeoutMs, tokenValue: secret });
  const document = data.nodes?.[nodeId]?.document;
  if (!document) {
    throw new StoppedError(
      'http-404',
      'Figma 文件或节点不存在。请核对链接里的 fileKey 与 node-id 是否仍有效。',
    );
  }
  if (document.type === 'FRAME') {
    throw new StoppedError(
      'not-canvas',
      '这个 node 是 Frame，不是页面（CANVAS）。请改给 Figma 左侧页面链接，不要用画布里的 Frame。本命令不会自动上找页面。',
    );
  }
  if (document.type !== 'CANVAS') {
    throw new StoppedError(
      'not-canvas',
      `这个 node 是 ${document.type}，不是页面（CANVAS）。请改给 Figma 左侧页面链接。本命令不会自动上找页面。`,
    );
  }
  if (data.version == null || String(data.version) === '') {
    throw new StoppedError('no-version', 'Figma 没有返回文件 version。请稍后重试。');
  }
  return {
    fileVersion: String(data.version),
    nodeType: document.type,
    nodeName: document.name ?? '',
  };
}
