function isScriptTagBoundary(html, afterName) {
  if (afterName >= html.length) return true;
  const ch = html.charAt(afterName);
  return ch === '>' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

export function nextScriptOpen(html, from) {
  const lower = html.toLowerCase();
  let pos = from;
  while (pos < html.length) {
    const start = lower.indexOf('<script', pos);
    if (start < 0) return { start: -1, openEnd: -1 };
    const afterName = start + 7;
    if (!isScriptTagBoundary(html, afterName)) {
      pos = afterName;
      continue;
    }
    const gt = html.indexOf('>', start);
    return { start, openEnd: gt < 0 ? html.length : gt + 1 };
  }
  return { start: -1, openEnd: -1 };
}

export function nextScriptCloseEnd(html, from) {
  const lower = html.toLowerCase();
  let pos = from;
  while (pos < html.length) {
    const idx = lower.indexOf('</script', pos);
    if (idx < 0) return html.length;
    if (!isScriptTagBoundary(html, idx + 8)) {
      pos = idx + 8;
      continue;
    }
    const gt = html.indexOf('>', idx);
    return gt < 0 ? html.length : gt + 1;
  }
  return html.length;
}

export function htmlWithoutScripts(html) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const open = nextScriptOpen(html, i);
    if (open.start < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, open.start);
    i = nextScriptCloseEnd(html, open.openEnd);
  }
  return out;
}

export function extractScriptBodies(html) {
  const bodies = [];
  let i = 0;
  while (i < html.length) {
    const open = nextScriptOpen(html, i);
    if (open.start < 0) break;
    const closeEnd = nextScriptCloseEnd(html, open.openEnd);
    bodies.push(html.slice(open.openEnd, closeEnd));
    i = closeEnd;
  }
  return bodies;
}
