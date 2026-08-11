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
  const revealSections = (Array.isArray(followingSections) ? followingSections : [])
    .map((section) => ({ id: section?.id == null ? null : String(section.id), y: Number(section?.y) }))
    .filter((section) => section.id != null && Number.isFinite(section.y) && section.y < Number(pageOriginY || 0) + designHeight - 0.5)
    .map((section) => ({ ...section, distance: Math.max(0, Number(pageOriginY || 0) + designHeight - section.y) }));
  const revealDistance = Math.max(0, ...revealSections.map((section) => section.distance));
  const releaseDistance = revealDistance;
  const startsAtPageOrigin = Math.abs(firstY - Number(pageOriginY || 0)) <= 0.5;
  if (!startsAtPageOrigin || contentRootId == null) return null;
  return {
    stateVersion: 'hero-scroll-slot/v2',
    sectionId: firstSection.id == null ? null : String(firstSection.id),
    contentRootId: String(contentRootId),
    viewportHeight: viewport,
    scale: factor,
    heroHeight,
    designHeight,
    extra,
    releaseDistance,
    /* The extra range is visual reveal distance only. It must not become a
       permanent offset on every later section: only the first following
       section that would otherwise leak into the viewport consumes it, and
       its translate returns to the Figma source coordinate by release. */
    revealSections,
    revealSectionId: revealSections[0]?.id || null,
    revealDistance,
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
