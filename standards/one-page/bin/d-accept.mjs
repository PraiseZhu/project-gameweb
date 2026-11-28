import { main } from '../src/d-accept.mjs';

process.exitCode = await main(process.argv[2], process.argv.slice(3));
