#!/usr/bin/env node
/**
 * Run every browser test in turn and print one line each.
 *
 *   node test/browser/run.mjs
 *
 * Needs Chromium on the PATH; without it everything is skipped and this exits 0.
 * Each test starts its own preview server, so nothing needs to be running first.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findChromium } from './lib.mjs';

const TESTS = ['test-theme', 'test-contribute', 'test-tasks', 'test-allstars', 'test-home'];

if (!findChromium()) {
  console.log('\n  SKIPPED the browser tests: no Chromium on the PATH.\n');
  process.exit(0);
}

let failed = 0;
for (const name of TESTS) {
  const file = fileURLToPath(new URL(`./${name}.mjs`, import.meta.url));
  const res = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 240000 });
  const summary = (res.stdout.match(/\d+ passed, \d+ failed/g) || ['no result']).pop();
  console.log(`  ${res.status === 0 ? 'ok  ' : 'FAIL'}  ${name.padEnd(18)} ${summary}`);
  if (res.status !== 0) {
    failed++;
    console.log(res.stdout.split('\n').filter((l) => /FAIL/.test(l)).join('\n') || res.stderr.slice(-600));
  }
}
process.exit(failed ? 1 : 0);
