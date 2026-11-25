#!/usr/bin/env node
import { main } from '../src/handoff-check.mjs';

process.exitCode = main(process.argv.slice(2));
