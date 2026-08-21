import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

/** Write a group of related files with rollback if any replacement fails. */
export function writeFilesAtomically(entries) {
  const staged = [];
  try {
    for (const [target, content] of entries) {
      const temp = `${target}.tmp-${process.pid}-${staged.length}`;
      const backup = `${target}.bak-${process.pid}-${staged.length}`;
      writeFileSync(temp, content);
      staged.push({ target, temp, backup, hadOriginal: existsSync(target), installed: false });
    }
    for (const item of staged) {
      if (item.hadOriginal) renameSync(item.target, item.backup);
      renameSync(item.temp, item.target);
      item.installed = true;
    }
  } catch (error) {
    for (const item of staged) {
      if (item.installed && existsSync(item.target)) unlinkSync(item.target);
      if (item.hadOriginal && existsSync(item.backup)) renameSync(item.backup, item.target);
      if (existsSync(item.temp)) unlinkSync(item.temp);
    }
    throw error;
  }
  for (const item of staged) {
    try { if (existsSync(item.backup)) unlinkSync(item.backup); } catch { /* 留下备份不破坏一致性 */ }
  }
}
