#!/usr/bin/env node
import { main } from '../src/b-extract.mjs';

process.exit(await main(process.argv.slice(2)));
