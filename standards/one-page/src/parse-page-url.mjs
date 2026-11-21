import { StoppedError } from './stopped.mjs';

const FILE_KEY = /^[A-Za-z0-9]+$/;
const NODE_ID = /^\d+:\d+$/;

export function normalizeNodeId(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const colon = text.replace(/-/g, ':');
  return NODE_ID.test(colon) ? colon : null;
}

export function parsePageUrl(raw) {
  if (raw == null || String(raw).trim() === '') {
    throw new StoppedError(
      'invalid-url',
      '没有 Figma 页面链接。请提供带 node-id 的 figma.com/design 或 /file 页面链接。',
    );
  }
  const link = String(raw).trim();
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new StoppedError(
      'invalid-url',
      'Figma 链接无法解析。请提供完整的 https://www.figma.com/design/... 或 /file/... 页面链接，并带 node-id。',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new StoppedError(
      'invalid-url',
      '只接受 http(s) 的 Figma 页面链接。',
    );
  }

  const host = url.hostname.toLowerCase();
  if (host === 'figjam.com' || host === 'www.figjam.com') {
    throw new StoppedError(
      'figjam',
      '这是 FigJam 链接，不是 Figma 设计页面。请改给设计文件的页面链接。',
    );
  }
  if (host !== 'figma.com' && host !== 'www.figma.com') {
    throw new StoppedError(
      'invalid-url',
      '只接受 figma.com 的设计页面链接。',
    );
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const kind = (parts[0] || '').toLowerCase();
  if (kind === 'proto') {
    throw new StoppedError(
      'proto',
      '这是原型链接。请改给设计文件里的页面链接（figma.com/design/... 或 /file/...），不要用原型。',
    );
  }
  if (kind === 'board' || kind === 'figjam') {
    throw new StoppedError(
      'figjam',
      '这是 FigJam 链接，不是 Figma 设计页面。请改给设计文件的页面链接。',
    );
  }
  if (kind !== 'design' && kind !== 'file') {
    throw new StoppedError(
      'invalid-url',
      '只接受 figma.com/design/…、/file/… 或带 /branch/<key> 的页面链接。',
    );
  }

  const sourceFileKey = parts[1];
  if (!sourceFileKey || !FILE_KEY.test(sourceFileKey)) {
    throw new StoppedError('invalid-url', '链接里解析不到 fileKey。请确认是 figma.com/design/<fileKey>/... 形式。');
  }

  let fileKey = sourceFileKey;
  const branchAt = parts.findIndex((part) => part.toLowerCase() === 'branch');
  if (branchAt >= 0) {
    const branchKey = parts[branchAt + 1];
    if (!branchKey || !FILE_KEY.test(branchKey)) {
      throw new StoppedError('invalid-url', '分支链接缺少有效的 /branch/<key>。');
    }
    fileKey = branchKey;
  }

  const rawNode = url.searchParams.get('node-id');
  if (rawNode == null || rawNode === '') {
    throw new StoppedError(
      'no-node-id',
      '链接没有 node-id。请在 Figma 左侧选中页面（不是 Frame）后复制页面链接。',
    );
  }
  const nodeId = normalizeNodeId(rawNode);
  if (!nodeId) {
    throw new StoppedError(
      'no-node-id',
      'node-id 无法识别。请使用 1429-3019 或 1429:3019 这种形式。',
    );
  }

  return {
    link,
    fileKey,
    sourceFileKey,
    nodeId,
    nodeIdPath: nodeId.replace(/:/g, '-'),
  };
}
