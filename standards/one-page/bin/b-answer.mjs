#!/usr/bin/env node
import { main } from '../src/b-answer.mjs';

process.exit(await main(process.argv.slice(2)));
