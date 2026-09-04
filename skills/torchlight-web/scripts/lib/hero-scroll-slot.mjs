// Generic Hero Scroll-Slot contract. Figma supplies geometry; the browser
// supplies scrollTop and viewport changes. No page/node name is required.

export const HERO_SCROLL_STATES = Object.freeze([
  'HERO_LOCKED',
  'HERO_EXITING',
  'CONTENT_RELEASED',
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function resolveHeroContentRoot({
  pagePaintOrder = [],
  firstSectionId = null,
  unwrap = (value) => value,
} = {}) {
  const sid = firstSectionId == null ? '' : String(unwrap(firstSectionId));
  if (!sid || !Array.isArray(pagePaintOrder) || !pagePaintOrder.length) return null;
  const listed = pagePaintOrder.find((entry) => {
    const sectionIds = Array.isArray(entry && entry.sectionIds) ? entry.sectionIds : [];
    return sectionIds.some((id) => String(unwrap(id)) === sid);
  });
  if (listed) {
    const id = unwrap(listed.id);
    return id == null ? null : String(id);
  }
  /* SS6 mobile (and similar) may keep the first page-paint sibling as a visual
     root without repeating sectionIds. If the first section already starts at
     page origin, that sibling is still the content root — do not invent a third
     layout, and do not refuse the 100vh hero slot. */
  if (pagePaintOrder.length === 1) {
    const id = unwrap(pagePaintOrder[0] && pagePaintOrder[0].id);
    return id == null ? null : String(id);
  }
  return null;
}

export function buildHeroScrollSlot({ viewportHeight, scale, pageOriginY = 0, firstSection = {}, followingSections = [], contentRootId = null } = {}) {
  const viewport = Number(viewportHeight);
  const factor = Number(scale);
  const heroHeight = Number(firstSection.height);
  const firstY = Number(firstSection.y);
  const valid = Number.isFinite(viewport) && viewport > 0
    && Number.isFinite(factor) && factor > 0
    && Number.isFinite(heroHeight) && heroHeight > 0
    && Number.isFinite(firstY);
  if (!valid) return null;
  const designHeight = viewport / factor;
  /* 100vh may pad a short hero. A taller Figma hero must keep its full
     pageBox and flow downward — never crop, never pull later sections up. */
  const extra = Math.max(0, designHeight - heroHeight);
  const layoutOffsetDesign = extra;
  const releaseDistance = extra * factor;
  const startsAtPageOrigin = Math.abs(firstY - Number(pageOriginY || 0)) <= 0.5;
  if (!startsAtPageOrigin || contentRootId == null) return null;
  return {
    stateVersion: 'hero-scroll-slot/v3',
    sectionId: firstSection.id == null ? null : String(firstSection.id),
    contentRootId: String(contentRootId),
    viewportHeight: viewport,
    scale: factor,
    heroHeight,
    designHeight,
    extra,
    layoutOffsetDesign,
    releaseDistance,
    revealSections: [],
    revealSectionId: null,
    revealDistance: 0,
    stateAt(scrollTop = 0) {
      const top = Math.max(0, Number(scrollTop) || 0);
      if (top <= 0.5) return { state: 'HERO_LOCKED', progress: 0, scrollTop: top };
      const progress = releaseDistance > 0 ? clamp(top / releaseDistance, 0, 1) : 1;
      return {
        state: top + 0.5 >= releaseDistance ? 'CONTENT_RELEASED' : 'HERO_EXITING',
        progress,
        scrollTop: top,
      };
    },
  };
}

export function assertHeroScrollSlotState(state) {
  return !!state && HERO_SCROLL_STATES.includes(state.state);
}
