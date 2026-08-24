#!/usr/bin/env node
/**
 * 未规范目录对照已迁到 projects/project-unnamed-inventory。
 * 本仓再跑必须失败。
 */
import { UNNAMED_REDIRECT } from "../src/inventory.mjs";

console.error(UNNAMED_REDIRECT);
process.exit(1);
