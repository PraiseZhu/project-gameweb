export function framePoint(frame, clientX, clientY) {
  const { left, top, width, height } = frame.getBoundingClientRect();
  const view = frame.contentWindow;
  if (!width || !height || !view?.innerWidth || !view.innerHeight || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const fitScale = width / view.innerWidth;
  const point = { x:(clientX - left) / fitScale, y:(clientY - top) / (height / view.innerHeight) };
  return point.x >= 0 && point.y >= 0 && point.x < view.innerWidth && point.y < view.innerHeight ? point : null;
}

export function locateComment(frame, point, config) {
  if (!point) return null;
  const document = frame.contentDocument;
  const screen = document.querySelector('[data-screen].is-current');
  let element = document.elementFromPoint(point.x, point.y);
  while (element && !config.nodes.has(element.id)) element = element.parentElement;
  const node = config.nodes.get(element?.id);
  if (!screen || !node || element.closest('[hidden],[inert]')) return null;
  const { end, module, nodeId, domId, role } = node;
  const selected = [...screen.querySelectorAll('[data-tab-group][aria-selected="true"]')].map((tab) => tab.id).sort().join(' ');
  const cases = config.cases.filter((row) => row.screen === screen.id && [...row.selectedTabs].sort().join(' ') === selected);
  const exact = cases.find((row) => row.caseId === 'default') ?? (cases.length === 1 ? cases[0] : undefined);
  return { target: { end, module, nodeId, domId }, role, screen:screen.id, caseId:exact?.caseId ?? null, point,
    viewport:{ width:frame.contentWindow.innerWidth, height:frame.contentWindow.innerHeight } };
}

export function createQaComments({ fields, config, focus }) {
  let location = null;
  const rows = [];
  function setLocation(next) {
    location = next;
    fields.location.textContent = next ? next.target.domId + ' · ' + next.point.x.toFixed(1) + ', ' + next.point.y.toFixed(1) : '未定位';
  }
  fields.clear.addEventListener('click', () => setLocation(null));
  fields.comments.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = fields.comment.value.trim();
    if (!text) return;
    rows.push({ text, location });
    const item = document.createElement('li');
    item.textContent = location ? location.target.domId + '：' + text : '未定位：' + text;
    fields.notes.append(item);
    fields.comment.value = '';
    setLocation(null);
    focus();
  });
  fields.export.addEventListener('click', () => {
    const bundle = { schema:'onepage-d-comments/v1', base:config.base, fingerprint:config.fingerprint,
      located:rows.filter((row) => row.location), unlocated:rows.filter((row) => !row.location) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type:'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'onepage-d-comments.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return { setLocation };
}
