#!/usr/bin/env node
/**
 * 未规范 newDraftGate 评测已迁到 projects/project-unnamed-inventory。
 * 本仓再跑必须失败，避免假装评测还在这里。
 */
import { UNNAMED_REDIRECT } from "../src/inventory.mjs";

console.error(UNNAMED_REDIRECT);
process.exit(1);
