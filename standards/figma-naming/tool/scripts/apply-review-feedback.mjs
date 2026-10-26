#!/usr/bin/env node
/**
 * 判断写回已废弃，本仓再跑必须失败。
 * 本仓再跑必须失败，避免假装未规范写回还在这里。
 */
import { UNNAMED_REDIRECT } from "../src/inventory.mjs";

console.error(UNNAMED_REDIRECT);
process.exit(1);
