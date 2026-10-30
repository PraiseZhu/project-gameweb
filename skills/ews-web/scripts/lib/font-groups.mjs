// Agent-authored semantic groups. IDs belong in input data, never in runtime code.
export function applyFontGroups(platform, groups = []) {
  const problems = [], members = new Map(), found = new Set();
  if (!Array.isArray(groups)) return ['font-groups:expected-array'];
  const ids = new Set();
  for (const group of groups) {
    if (!group?.id || !group.why?.trim() || !Array.isArray(group.members) || new Set(group.members).size < 2 || ids.has(group.id)) {
      problems.push(`font-groups:${group?.id}:invalid-group`); continue;
    }
    ids.add(group.id);
    for (const member of group.members) {
      if (members.has(member)) problems.push(`font-groups:${member}:duplicate-member`);
      members.set(member, group.id);
    }
  }
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.type === 'TEXT' && value.text) {
      const keys = [value.id, value.sourceNodeId].filter(key => members.has(key));
      if (new Set(keys.map(key => members.get(key))).size > 1) problems.push(`font-groups:${value.id}:conflicting-clone`);
      if (keys.length) { value.fontGroup = members.get(keys[0]); keys.forEach(key => found.add(key)); }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(platform);
  for (const member of members.keys()) if (!found.has(member)) problems.push(`font-groups:${member}:text-node-missing`);
  platform.fontGroups = groups;
  return problems;
}
