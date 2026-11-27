import { main } from '../src/c-patch.mjs';

process.exitCode = await main(process.argv.slice(2));
