// Canonical inline block contract for generated index.html files.
// init.mjs creates blocks from this table; figma-inline.mjs and update paths
// locate and replace blocks from the same table.

export const INLINE_MARKERS = {
  render: {
    template: 'figma-render.js',
    begin: '/* FIGMA_RENDER_BEGIN',
    end: '/* FIGMA_RENDER_END */',
    headRe: /^\/\* figma-render\.js\b/,
  },
  chrome: {
    template: 'figma-chrome.js',
    begin: '/* FIGMA_CHROME_BEGIN',
    end: '/* FIGMA_CHROME_END */',
    headRe: /^\/\* figma-chrome\.js\b/,
  },
  qaChrome: {
    template: 'qa-chrome.js',
    begin: '/* QA_CHROME_BEGIN',
    end: '/* QA_CHROME_END */',
    headRe: /^\/\* qa-chrome\.js\b/,
  },
  componentAdapter: {
    template: 'qa-component-adapter.js',
    begin: '/* QA_COMPONENT_ADAPTER_BEGIN',
    end: '/* QA_COMPONENT_ADAPTER_END */',
    headRe: /^\/\* qa-component-adapter\.js\b/,
  },
};

export const INLINE_PLACEHOLDERS = {
  '{{QA_CHROME}}': 'qaChrome',
  '{{QA_COMPONENT_ADAPTER}}': 'componentAdapter',
  '{{FIGMA_RENDER}}': 'render',
  '{{FIGMA_CHROME}}': 'chrome',
};

export function markerFor(name) {
  const marker = INLINE_MARKERS[name];
  if (!marker) {
    throw new Error(`unknown inline block: ${name} (valid: ${Object.keys(INLINE_MARKERS).join(' / ')})`);
  }
  return marker;
}

export function locateInlineBlock(html, name) {
  const marker = markerFor(name);
  let b = html.indexOf(marker.begin);
  let e = html.indexOf(marker.end);
  let replaceEnd = e + marker.end.length;
  if (b < 0 || e < 0) {
    b = html.search(marker.headRe);
    e = b >= 0 ? html.indexOf('\n</script>', b) : -1;
    replaceEnd = e;
  }
  if (b < 0 || e < 0) return null;
  if (e < b) throw new Error(`${name} inline block markers are reversed`);
  return { b, e, replaceEnd, part: marker };
}

export function buildInlineBlock(name, templateSource) {
  const marker = markerFor(name);
  const body = `${marker.begin} */\n${templateSource}`;
  return body.replace(/\s*$/, '\n') + marker.end;
}
