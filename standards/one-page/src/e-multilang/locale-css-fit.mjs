export function localeSelector(tag, id) {
  if (!/^[a-zA-Z-]+$/.test(tag) || !/^[\w-]+$/.test(id)) throw new Error('非法本地化样式锚点');
  return 'html:lang(' + tag + ') #' + id;
}

export function fitGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.end, row.screen, row.parent, row.role]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function minimumScale(row) {
  if (!Number.isFinite(row.fontPx) || row.fontPx <= 0) throw new Error('缺文字实测字号：' + row.id);
  return Math.max(.75, 12 / row.fontPx);
}

export function fitGroup(group) {
  const broken = group.filter((row) => row.overflow);
  if (!broken.length) return [];
  if (group.some((row) => row.locked)) throw new Error('排版组包含手调锁定对象：' + group.map((row) => row.id).join(', '));
  const scale = Math.max(...group.map(minimumScale));
  if (scale >= 1) throw new Error('排版组不能在字号底线内缩小：' + group.map((row) => row.id).join(', '));
  return group.map(({ id, fontPx }) => ({ id, scale, originalPx:fontPx }));
}

export function readLocaleLocks(css, tag, rows) {
  const starts = [...css.matchAll(/\/\* localeOverrides:start \*\//g)];
  const ends = [...css.matchAll(/\/\* localeOverrides:end \*\//g)];
  if (!starts.length && !ends.length) return [];
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) throw new Error('localeOverrides 边界不完整');
  const body = css.slice(starts[0].index + starts[0][0].length, ends[0].index).trim();
  const locks = [];
  let remaining = body;
  while (remaining) {
    const match = /^html:lang\(([a-zA-Z-]+)\) #([\w-]+)\s*\{([^{}]+)\}/.exec(remaining);
    if (!match) throw new Error('localeOverrides 只接受精确语言与对象锚点');
    if (match[1] === tag) {
      if (!rows.some((row) => row.id === match[2]) || locks.includes(match[2])) throw new Error('localeOverrides 含未知或重复对象：' + match[2]);
      locks.push(match[2]);
    }
    remaining = remaining.slice(match[0].length).trim();
  }
  return locks;
}
