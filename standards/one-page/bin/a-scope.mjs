#!/usr/bin/env node
import { main } from '../src/a-scope.mjs';

process.exit(await main(process.argv.slice(2)));
