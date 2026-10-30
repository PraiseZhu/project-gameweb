/**
 * Optional same-origin QA comment share. Protocol matches torchlight
 * docs/qa-comments.md: GET/POST ?pageKey=, { comments, durable:true } /
 * { comment, durable:true }. This module only validates Skill config.
 * It does not create a Worker or point at any live host.
 */
const MAX_API = 200;
const MAX_PAGE_ID = 300;

export function resolveCommentShare(input = {}) {
  const problems = [];
  let commentApi = input.commentApi ?? null;
  let commentPageId = input.commentPageId ?? null;

  if (commentApi == null || commentApi === '') {
    commentApi = null;
  } else if (typeof commentApi !== 'string') {
    problems.push('commentApi 必须是同站路径字符串，例如 /api/qa-comments');
    commentApi = null;
  } else {
    const value = commentApi.trim();
    let parsed = null;
    try { parsed = new URL(value, 'http://ews.invalid'); } catch { parsed = null; }
    if (
      !value.startsWith('/')
      || value.startsWith('//')
      || !parsed
      || parsed.host !== 'ews.invalid'
      || parsed.username
      || parsed.password
      || value.length > MAX_API
    ) {
      problems.push('commentApi 必须是同站绝对路径（通常 /api/qa-comments，可带既有 query）。出页不写外部主机，部署时由站点 Worker 提供');
    } else {
      parsed.hash = '';
      const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
      commentApi = pathname + parsed.search;
    }
  }

  if (commentPageId == null || commentPageId === '') {
    commentPageId = null;
  } else if (typeof commentPageId !== 'string') {
    problems.push('commentPageId 必须是稳定页键字符串，不是 Figma id');
    commentPageId = null;
  } else {
    const value = commentPageId.trim();
    if (!value || value.length > MAX_PAGE_ID) {
      problems.push('commentPageId 必须是 1–300 字的稳定页键，不是 Figma id');
    } else if (/[/?#\s]/.test(value)) {
      problems.push('commentPageId 不能含空白、路径或 query 字符');
    } else {
      commentPageId = value;
    }
  }

  return { ok: problems.length === 0, commentApi, commentPageId, problems };
}

export function applyCommentShareCli(config, argv = []) {
  const next = { ...(config || {}) };
  const api = flag(argv, '--comment-api');
  const page = flag(argv, '--comment-page-id');
  if (api != null) next.commentApi = api;
  if (page != null) next.commentPageId = page;
  return next;
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}
