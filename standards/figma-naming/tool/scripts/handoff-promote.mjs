#!/usr/bin/env node
/**
 * draft → ready 升档已废弃，本仓再跑必须失败。
 * 本仓只打已规范 ready 包，promote 必须失败。
 */
import { UNNAMED_REDIRECT } from "../src/inventory.mjs";

console.error(UNNAMED_REDIRECT);
process.exit(1);
