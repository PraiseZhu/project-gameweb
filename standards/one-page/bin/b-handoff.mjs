#!/usr/bin/env node
import { main } from '../src/b-handoff.mjs';

process.exitCode = main(process.argv.slice(2));
