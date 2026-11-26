#!/usr/bin/env node
import { main } from '../src/c-page-generate.mjs';

process.exitCode = main(process.argv.slice(2));
