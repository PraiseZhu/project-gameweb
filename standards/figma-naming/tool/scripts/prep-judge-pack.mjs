#!/usr/bin/env node
/**
 * 判断包已迁到 projects/project-unnamed-inventory。
 * 本仓再跑必须失败，避免假装未规范判定还在这里。
 */
import { UNNAMED_REDIRECT } from "../src/inventory.mjs";

console.error(UNNAMED_REDIRECT);
process.exit(1);
