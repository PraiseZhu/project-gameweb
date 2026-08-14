import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const exclusions = JSON.parse(readFileSync(fileURLToPath(new URL('./nightly-exclusions.json', import.meta.url)), 'utf8'));

export const DEMO_NAMED_TESTS = exclusions.demo;
export const BROKEN_PUBLIC = Object.fromEntries(
  Object.entries(exclusions.broken).map(([rel, reason]) => [rel.split('/').pop(), reason]),
);
