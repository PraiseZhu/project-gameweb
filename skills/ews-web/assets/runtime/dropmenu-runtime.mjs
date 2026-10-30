import { langFromSelfLabel } from './dropmenu-lang.mjs';

function setState(owner, state) {
  owner.setAttribute('data-dropmenu-state', state);
  const onLayer = owner.querySelector(':scope > [data-dropmenu-layer="on"]');
  const offLayer = owner.querySelector(':scope > [data-dropmenu-layer="off"]');
  if (onLayer) onLayer.hidden = state !== 'on';
  if (offLayer) offLayer.hidden = state !== 'off';
}

function closeAll(root) {
  for (const owner of root.querySelectorAll('[data-dropmenu="true"]')) setState(owner, 'off');
}

export function mountDropmenus(root, { onLanguage, enabled = false } = {}) {
  if (!root?.querySelectorAll) return { dispose() {} };
  if (!enabled) {
    for (const owner of root.querySelectorAll('[data-dropmenu="true"]')) setState(owner, 'off');
    return { dispose() {} };
  }
  for (const owner of root.querySelectorAll('[data-dropmenu="true"]')) setState(owner, 'off');

  const onClick = (event) => {
    const owner = event.target.closest?.('[data-dropmenu="true"]');
    if (!owner || !root.contains(owner)) {
      closeAll(root);
      return;
    }
    if (owner.getAttribute('data-dropmenu-state') === 'on') {
      const option = event.target.closest?.('[data-dropmenu-option], [data-role="btn"]');
      if (option && owner.contains(option)) {
        const labeled = option.getAttribute('data-locale')
          || langFromSelfLabel(option.innerText || option.textContent || '');
        closeAll(root);
        if (labeled) onLanguage?.(labeled);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    const next = owner.getAttribute('data-dropmenu-state') === 'on' ? 'off' : 'on';
    closeAll(root);
    setState(owner, next);
    event.stopPropagation();
  };

  const onDoc = (event) => {
    if (event.target.closest?.('[data-dropmenu="true"]')) return;
    closeAll(root);
  };

  root.addEventListener('click', onClick);
  document.addEventListener('click', onDoc);
  return {
    dispose() {
      root.removeEventListener('click', onClick);
      document.removeEventListener('click', onDoc);
    },
  };
}
