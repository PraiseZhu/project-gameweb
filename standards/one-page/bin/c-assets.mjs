#!/usr/bin/env node
import { main } from '../src/c-assets.mjs';

process.exitCode = await main(process.argv.slice(2));
