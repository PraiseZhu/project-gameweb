/**
 * 工作区 report/ 只放当前名单；历史探针/看图证据在 report/archive/。
 * 读的时候先工作区、没有再回退 archive，重跑仍写工作区。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveReportFile(reportDir, name) {
  const live = join(reportDir, name);
  if (existsSync(live)) return live;
  const archived = join(reportDir, "archive", name);
  if (existsSync(archived)) return archived;
  return live;
}
