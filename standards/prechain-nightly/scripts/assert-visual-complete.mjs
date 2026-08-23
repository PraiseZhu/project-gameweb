#!/usr/bin/env node
/** 50 轮全部 verify 通过才算夜间看图完成。 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VISUAL_ROUNDS } from "../src/visual-round.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const nightDir = process.argv[2];
if (!nightDir) {
  console.error("用法：node scripts/assert-visual-complete.mjs <nightDir>");
  process.exit(2);
}
const ran = spawnSync(process.execPath, [join(here, "aggregate-visual-rounds.mjs"), "--dir", nightDir, "--expected", String(VISUAL_ROUNDS)], {
  encoding: "utf8",
});
if (ran.stdout) process.stdout.write(ran.stdout);
if (ran.stderr) process.stderr.write(ran.stderr);
process.exit(ran.status === 0 ? 0 : 1);
