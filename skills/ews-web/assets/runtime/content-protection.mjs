/**
 * Product-stage content protection, aligned with torchlight's
 * figma-render / demo-shell policy and scoped to `.ews-root`.
 * Blocks ordinary drag / select / right-click / long-press save on page
 * artwork. Does not apply to QA chrome. Does not stop DevTools, the
 * network panel, or screenshots.
 */
const MEDIA = 'img,svg,video,canvas';
const EVENTS = ['selectstart', 'copy', 'cut', 'dragstart', 'contextmenu'];

function pageRootOf(host) {
  if (!host) return null;
  if (host.classList?.contains('ews-root')) return host;
  return host.querySelector?.('.ews-root') || null;
}

function isEditableControl(element) {
  const control = element?.closest?.('input,textarea');
  if (!control || control.readOnly || control.matches(':disabled')) return false;
  const type = String(control.type || (control.localName === 'textarea' ? 'textarea' : 'text'));
  return /^(textarea|text|search|email|url|tel|password|number)$/.test(type);
}

function stampMedia(scope) {
  if (!scope?.querySelectorAll) return;
  const items = [];
  if (scope.matches?.(MEDIA)) items.push(scope);
  items.push(...scope.querySelectorAll(MEDIA));
  for (const el of items) {
    if ((el.localName === 'img' || el.localName === 'video') && el.getAttribute('draggable') !== 'false') {
      el.setAttribute('draggable', 'false');
    }
  }
}

export function installContentProtection(host) {
  const page = pageRootOf(host);
  if (!page) return { dispose() {} };

  const stop = (event) => {
    const target = event.composedPath?.()[0] || event.target;
    const element = target?.nodeType === 3 ? target.parentElement : target;
    if (!element || !page.contains(element)) return;
    const media = element.closest?.(MEDIA);
    if (isEditableControl(element) && !media) return;
    event.preventDefault();
  };

  for (const type of EVENTS) page.addEventListener(type, stop, true);
  const observer = typeof MutationObserver === 'function'
    ? new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const el = record.target;
          if ((el.localName === 'img' || el.localName === 'video') && el.getAttribute('draggable') !== 'false') {
            el.setAttribute('draggable', 'false');
          }
        } else {
          for (const node of record.addedNodes || []) stampMedia(node);
        }
      }
    })
    : null;
  observer?.observe(page, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['draggable'],
  });
  stampMedia(page);
  page.setAttribute('data-content-protection', 'v1');
  return {
    dispose() {
      for (const type of EVENTS) page.removeEventListener(type, stop, true);
      observer?.disconnect();
    },
  };
}
