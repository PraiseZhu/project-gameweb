// Semantic role resolution for optional motion adapters.  This is deliberately
// derived from captured Figma component labels and page structure, never from
// page-specific node IDs, section ordinals, or visible marketing titles.

const list = (value) => Array.isArray(value) ? value : Object.values(value || {});
const text = (value) => String(value || '').trim().toLowerCase();
const names = (node) => [node?.name, ...(node?.ancestorNames || [])].map(text).filter(Boolean);
const has = (values, re) => values.some((value) => re.test(value));
const idOf = (node) => node?.id == null ? null : String(node.id);

function add(out, node, role, step, evidence) {
  const id = idOf(node);
  if (!id || out.has(id)) return;
  out.set(id, { role, step, evidenceStatus: 'truth-backed', evidence });
}

/* Transparent semantic owners can be omitted from truth. Target only their
   direct rendered children so nested labels do not inherit motion twice. */
function isDirectChildOfAncestor(node, re) {
  const ancestry = Array.isArray(node?.ancestorNames) ? node.ancestorNames : [];
  const path = Array.isArray(node?.ownerPath) ? node.ownerPath : [];
  const semanticIndex = ancestry.findIndex((name) => re.test(text(name)));
  return semanticIndex >= 0 && path.length > 1
    && String(path[semanticIndex] ?? '') === String(path[path.length - 2] ?? '');
}

export function deriveMotionRoles(truth = {}) {
  const roles = new Map();
  const sections = list(truth.sections);
  const ordered = sections.slice().sort((a, b) => Number(a?.meta?.y || 0) - Number(b?.meta?.y || 0));

  for (const [sectionIndex, section] of ordered.entries()) {
    for (const node of list(section?.nodes)) {
        const own = text(node?.name);
      // The first real content section is a structural KV anchor; its depth
      // layers still require explicit Figma `kv/*` labels before parallax opts in.
      if (sectionIndex === 0 && /^kv\/(?:background|背景|backdrop)$/.test(own)) {
        add(roles, node, 'kv-background', 0, 'first-section + kv/background component label');
      } else if (sectionIndex === 0 && /^kv\/(?:foreground|前景|midground|middle|中景|character|角色)$/.test(own)) {
        add(roles, node, 'kv-foreground', 0, 'first-section + kv/depth component label');
      } else if (sectionIndex === 0 && /^img\/(?:title|\u6807\u9898)[-_ ]?logo$/.test(own)) {
        add(roles, node, 'kvTitle', 0, 'first-section + title-logo component label');
      } else if (sectionIndex === 0 && /^img\/logo$/.test(own)) {
        add(roles, node, 'kvBrand', 0, 'first-section + brand-logo component label');
      } else if (sectionIndex === 0 && isDirectChildOfAncestor(node, /^btn\/(?:download|\u4e0b\u8f7d)/)) {
        add(roles, node, 'kvPrimaryAction', 0, 'first-section + direct child of download-button component');
      } else if (/^(?:mix\/)?calendar$/.test(own) || /^mix\/(?:calendar|日历)$/.test(own)) {
        add(roles, node, 'activityCalendar', 0, 'calendar component label');
      } else if (/^switch\/(?:source|\u6e90\u5668)$/.test(own)) {
        add(roles, node, 'sourceDevice', 0, 'source-device switch component label');
      } else if (/^(?:switch\/(?:character|角色)|skill\d*|技能\d*)$/.test(own)) {
        const step = /^skill|^技能/.test(own) ? 1 : 0;
        add(roles, node, 'characterSkill', step, 'character/skill component label');
      } else if (/^(?:heading|title|标题)$/.test(own)) {
        add(roles, node, 'headingContentCard', 0, 'heading component label');
      } else if (/^(?:content(?:-?card)?|card(?:\/.*)?|内容框|内容\d+)$/.test(own)) {
        add(roles, node, 'headingContentCard', 1, 'content-card component structure');
      } else if (/^(?:img\/)?(?:scroll(?:-?indicator)?|arrow|下滑箭头)$/.test(own)) {
        add(roles, node, 'scrollIndicator', 0, 'scroll indicator component label');
      }
    }
  }

  for (const node of list(truth.pageChrome?.nodes)) {
    const own = text(node?.name);
    if (/^kv\/(?:background|背景|backdrop)$/.test(own)) {
      add(roles, node, 'kv-background', 0, 'page chrome + kv/background component label');
    } else if (/^kv\/(?:foreground|前景|midground|middle|中景|character|角色)$/.test(own)) {
      add(roles, node, 'kv-foreground', 0, 'page chrome + kv/depth component label');
    } else if (/^(?:img\/)?(?:scroll(?:-?indicator)?|arrow|下滑箭头)$/.test(own)) {
      add(roles, node, 'scrollIndicator', 0, 'page chrome + scroll indicator component label');
    }
  }

  for (const node of list(truth.fixedOverlays?.nodes)) {
    const own = text(node?.name);
    if (/^(?:fix|nav|navigation|footer)\//.test(own)) {
      add(roles, node, 'navigationFooter', 0, 'fixed overlay component label');
      const rec = roles.get(idOf(node));
      if (rec) rec.navigation = true;
    }
  }
  return roles;
}

export function deriveSectionMotionRole({ sectionIndex = -1, section = null } = {}) {
  if (sectionIndex !== 0 || !section?.meta) return null;
  return { role: 'kv', step: 0, evidenceStatus: 'truth-backed', evidence: 'first section starts page content flow' };
}
