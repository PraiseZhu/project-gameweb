/**
 * Programmatic button hover / pressdown.
 *
 * This is not a Figma variant. Highlight/press brightness is a global runtime
 * affordance for named interactive controls. Source-backed COMPONENT_SET
 * highlight (Property 1=normal ↔ Property 1=highlight) stays a separate
 * replacement contract and must not be faked with CSS.
 *
 * Source: figma-acceptance-harness button hover/press pack, 2026-08-25.
 */

export const BUTTON_PRESS_SCHEMA = 'figma-button-press-contract/v1';

export const BUTTON_PRESS_TOKENS = Object.freeze({
  hoverBrightness: 1.12,
  pressBrightness: 0.88,
  transition: 'none',
});

export const BUTTON_PRESS_SELECTOR = [
  'button',
  '[role="button"]',
  '[data-link]',
  '[data-go]',
  '[data-sec-target]',
  '[data-switch-action]',
  '[data-tab]',
  '[data-indicator]',
  '[data-copy-code]',
  '[data-btn-press="true"]',
].join(', ');

const INTERACTIVE_ATTRS = [
  'data-link',
  'data-go',
  'data-sec-target',
  'data-switch-action',
  'data-hscroll-action',
  'data-calendar-now',
  'data-tab',
  'data-indicator',
  'data-copy-code',
  'data-btn-variant',
  'data-nav-item',
  'data-btn-press',
];

function withPseudo(selector, pseudo) {
  return String(selector).split(',').map((part) => `${part.trim()}${pseudo}`).join(',');
}

export function buttonPressCss({
  hoverBrightness = BUTTON_PRESS_TOKENS.hoverBrightness,
  pressBrightness = BUTTON_PRESS_TOKENS.pressBrightness,
} = {}) {
  const hover = Number(hoverBrightness);
  const press = Number(pressBrightness);
  const sel = BUTTON_PRESS_SELECTOR;
  return [
    `:root{--fx-hover-brightness:${hover};--fx-press-brightness:${press}}`,
    '[data-hscroll],[data-hscroll] img,[data-hscroll-surface],[data-switch-owner] img,[data-switch-swipe-host] img{-webkit-user-select:none;user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none}',
    `${sel},[data-hscroll-action],[data-calendar-now]{cursor:pointer}`,
    `@media (hover: hover){${withPseudo(sel, ':hover')}{filter:brightness(var(--fx-hover-brightness))}}`,
    `${withPseudo(sel, ':active')}{filter:brightness(var(--fx-press-brightness))}`,
    '[data-btn-press="inert"],[data-btn-press="inert"]:hover,[data-btn-press="inert"]:active{cursor:default;filter:none}',
  ].join('');
}

export function buttonPressKeyboardScript() {
  return [
    'document.addEventListener("keydown",function(ev){',
    'if(ev.key!=="Enter"&&ev.key!==" "&&ev.key!=="Spacebar")return;',
    'var el=ev.target;',
    'if(!el||!el.getAttribute||el.getAttribute("role")!=="button")return;',
    'if(el.getAttribute("data-btn-press")==="inert"||el.getAttribute("aria-disabled")==="true")return;',
    'ev.preventDefault();',
    'el.click();',
    '});',
  ].join('');
}

function hasNamedAction(parsed) {
  const params = parsed?.params || {};
  return Boolean(params.link || params.go || params.sec || params.target || params.section || params.to || params.dest);
}

/**
 * Attach hover/press semantics onto an already-derived interaction attribute map.
 * Disabled independent buttons stay inert. Draw-only btn/ still receive feel,
 * but do not invent URLs or highlight variants.
 */
export function attachButtonPressAttrs(attrs = {}, { role = null, controlState = null, parsed = null } = {}) {
  const next = { ...attrs };
  const disabled = controlState === 'disabled'
    || next['data-btn-press'] === 'inert'
    || /disable/.test(String(next['data-btn-variant-state'] || ''));
  const actionable = INTERACTIVE_ATTRS.some((key) => next[key] != null && next[key] !== '')
    || role === 'btn'
    || role === 'tab'
    || role === 'ind'
    || role === 'hot';
  if (!actionable) return next;
  if (disabled) {
    next['data-btn-press'] = 'inert';
    next['aria-disabled'] = 'true';
    return next;
  }
  next['data-btn-press'] = 'true';
  next.role = next.role || 'button';
  if (next.tabindex == null) next.tabindex = '0';
  if (role === 'btn' && !hasNamedAction(parsed) && !next['data-link'] && !next['data-go']
    && !next['data-sec-target'] && !next['data-switch-action'] && !next['data-hscroll-action']
    && !next['data-calendar-now'] && !next['data-copy-code']
    && !next['data-btn-variant'] && !next['data-nav-item'] && !next['data-tab']) {
    next['data-btn-action'] = 'unresolved';
  }
  return next;
}

export function installButtonPressRuntime(doc) {
  if (!doc?.head) return { installed: false };
  if (!doc.querySelector('style[data-fx-button-press]')) {
    const style = doc.createElement('style');
    style.setAttribute('data-fx-button-press', BUTTON_PRESS_SCHEMA);
    style.textContent = buttonPressCss();
    doc.head.appendChild(style);
  }
  if (!doc.documentElement?.hasAttribute('data-fx-button-press-keys')) {
    doc.documentElement.setAttribute('data-fx-button-press-keys', 'true');
    doc.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      const el = ev.target;
      if (!el?.getAttribute || el.getAttribute('role') !== 'button') return;
      if (el.getAttribute('data-btn-press') === 'inert' || el.getAttribute('aria-disabled') === 'true') return;
      ev.preventDefault();
      el.click();
    });
  }
  return { installed: true, selector: BUTTON_PRESS_SELECTOR, tokens: BUTTON_PRESS_TOKENS };
}
