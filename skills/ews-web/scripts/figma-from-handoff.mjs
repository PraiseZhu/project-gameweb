#!/usr/bin/env node
/**
 * Consume-only gate for Etheria-ews. Prints JSON. Never writes HTML.
 *
 *   npm run figma:from-handoff -- <handoff-dir>
 */
import { runFromHandoff } from './lib/from-handoff.mjs';

const dir = process.argv.slice(2).find((arg) => arg && !String(arg).startsWith('--')) || null;
const result = runFromHandoff(dir, { cwd: process.cwd() });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
