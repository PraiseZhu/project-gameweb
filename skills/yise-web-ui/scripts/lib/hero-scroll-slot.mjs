// Generic Hero Scroll-Slot contract. Figma supplies geometry; the browser
// supplies scrollTop and viewport changes. No page/node name is required.

export const HERO_SCROLL_STATES = Object.freeze([
  'HERO_LOCKED',
  'HERO_EXITING',
  'CONTENT_RELEASED',
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
