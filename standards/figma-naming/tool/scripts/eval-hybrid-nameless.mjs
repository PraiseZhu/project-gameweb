#!/usr/bin/env node
/**
 * 未规范 newDraftGate 评测已迁到 projects/project-unnamed-inventory。
 * 本仓再跑这条命令必须失败，避免假装评测还在这里。
 */
const message = "未规范 newDraftGate / eval-hybrid-nameless 已迁到 projects/project-unnamed-inventory（standards/prechain-nightly）。本仓只编已规范 ready。";
console.error(message);
process.exit(1);
