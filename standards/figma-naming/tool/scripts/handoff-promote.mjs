#!/usr/bin/env node
/**
 * draft → ready 升档已迁到 projects/project-unnamed-inventory。
 * 本仓只打已规范 ready 包，promote 必须失败。
 */
import { UNNAMED_REDIRECT } from "../src/inventory.mjs";

console.error(UNNAMED_REDIRECT);
process.exit(1);
