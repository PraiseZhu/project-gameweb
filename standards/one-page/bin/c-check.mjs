#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runCCheck } from '../src/c-check/index.mjs';

try {
  const { values } = parseArgs({ options: { pack: { type: 'string' }, out: { type: 'string' }, 'expect-version': { type: 'string' },
    'scope-version': { type: 'string' }, references: { type: 'string' }, 'references-sha256': { type: 'string' },
    'handoff-pack': { type: 'string' }, 'consumer-contract': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) console.log('c:check --pack <C2> --expect-version <SHA> --scope-version <SHA> --out <证据目录> [--references <索引> --references-sha256 <SHA>]');
  else {
    const result = await runCCheck({ pack: values.pack, out: values.out, expectVersion: values['expect-version'], scopeVersion: values['scope-version'],
      references: values.references, referencesSha256: values['references-sha256'],
      handoffPack: values['handoff-pack'], consumerContract: values['consumer-contract'] });
    console.log(JSON.stringify(result));
    if (result.status !== 'pass') process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
