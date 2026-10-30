// Reuse the delivered highlight/normal artwork and text paint. No hover state.
export function syncModalNavCurrent(root, key) {
  for (const modal of root.querySelectorAll('.ews-modal')) {
    const buttons = [...modal.querySelectorAll('[data-nav-screen]')];
    if (!buttons.length) continue;
    if (!modal.__ewsNavPaint) {
      const active = buttons.find(b => b.dataset.componentState === 'highlight');
      const normal = buttons.find(b => b.dataset.componentState === 'normal');
      const text = b => b?.querySelector('[data-figma-type="TEXT"]');
      if (!text(active) || !text(normal)) continue;
      const props = ['color', 'backgroundImage', 'backgroundClip', 'webkitBackgroundClip', 'webkitTextFillColor'];
      const paint = b => Object.fromEntries(props.map(p => [p, text(b).style[p]]));
      const decorations = [...active.children].filter(e => e.dataset.role === 'img');
      modal.__ewsNavPaint = { active: paint(active), normal: paint(normal) };
      for (const button of buttons) {
        const existing = [...button.children].filter(e => e.dataset.role === 'img');
        if (!existing.length) for (const decoration of decorations) {
          const copy = decoration.cloneNode(true);
          for (const el of [copy, ...copy.querySelectorAll('[data-node-id]')]) {
            el.removeAttribute('data-node-id'); el.removeAttribute('data-node');
          }
          copy.setAttribute('aria-hidden', 'true');
          button.prepend(copy);
        }
        for (const e of button.children) if (e.dataset.role === 'img') e.setAttribute('data-nav-decoration', '1');
      }
    }
    for (const button of buttons) {
      const active = button.dataset.navScreen === key;
      const text = button.querySelector('[data-figma-type="TEXT"]');
      if (text) Object.assign(text.style, modal.__ewsNavPaint[active ? 'active' : 'normal']);
      for (const el of button.querySelectorAll('[data-nav-decoration]')) el.style.visibility = active ? '' : 'hidden';
      button.setAttribute('data-nav-paint', active ? 'highlight' : 'normal');
    }
  }
}

// Language rows (PC dropmenu / mobile language modal): the delivered highlight row marks the current
// locale. Each row gets the other state's artwork as a hidden copy, then only the current locale
// shows the highlight paint. Reuses delivered highlight/normal artwork and text paint only.
export function syncLanguageCurrent(root, locale) {
  const rows = [...root.querySelectorAll('[data-locale][data-component-state]')];
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.parentElement) || [];
    list.push(row);
    groups.set(row.parentElement, list);
  }
  const kids = (row) => [...row.children].filter((e) => e.classList?.contains('ews-node') && e.dataset.figmaType !== 'TEXT' && !e.dataset.langPaint);
  const text = (row) => row.querySelector('[data-figma-type="TEXT"]');
  const props = ['color', 'backgroundImage', 'backgroundClip', 'webkitBackgroundClip', 'webkitTextFillColor'];
  for (const [host, list] of groups) {
    const hi = list.find((r) => r.dataset.componentState === 'highlight');
    const no = list.find((r) => r.dataset.componentState === 'normal');
    if (!hi || !no || !text(hi) || !text(no)) continue;
    if (!host.__ewsLangPaint) {
      const paint = (r) => Object.fromEntries(props.map((p) => [p, text(r).style[p]]));
      const art = { highlight: kids(hi), normal: kids(no) };
      host.__ewsLangPaint = { highlight: paint(hi), normal: paint(no) };
      for (const row of list) {
        const own = row.dataset.componentState === 'highlight' ? 'highlight' : 'normal';
        for (const e of kids(row)) e.setAttribute('data-lang-paint', own);
        const other = own === 'highlight' ? 'normal' : 'highlight';
        for (const source of [...art[other]].reverse()) {
          const copy = source.cloneNode(true);
          for (const el of [copy, ...copy.querySelectorAll('[data-node-id]')]) {
            el.removeAttribute('data-node-id');
            el.removeAttribute('data-node');
          }
          copy.setAttribute('aria-hidden', 'true');
          copy.setAttribute('data-lang-paint', other);
          row.prepend(copy);
        }
      }
    }
    for (const row of list) {
      const state = row.dataset.locale === locale ? 'highlight' : 'normal';
      for (const e of row.querySelectorAll(':scope > [data-lang-paint]')) e.style.visibility = e.dataset.langPaint === state ? '' : 'hidden';
      const t = text(row);
      if (t) Object.assign(t.style, host.__ewsLangPaint[state]);
      row.setAttribute('data-lang-current', state === 'highlight' ? '1' : '0');
    }
  }
}
