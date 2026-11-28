import { main } from '../src/e-multilang/e-build.mjs';

process.exitCode = await main(process.argv.slice(2));
