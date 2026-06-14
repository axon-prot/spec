#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

async function main() {
  const argv = require('minimist')(process.argv.slice(2), {
    string:  ['endpoint', 'level', 'timeout', 'report', 'filter'],
    boolean: ['verbose', 'no-color', 'help'],
    default: { level: '1', timeout: '5000', verbose: false },
    alias:   { h: 'help', v: 'verbose', e: 'endpoint', l: 'level' },
  });

  if (argv.help || !argv.endpoint) {
    console.log(`
AXON Protocol Conformance Suite — Test Runner

Usage
  node index.js --endpoint <url> [options]

Options
  -e, --endpoint <url>    Target implementation endpoint (required)
                          tcp://host:port  or  ws://host:port  or  wss://host:port
  -l, --level <n>         Conformance level: 1, 2, or 3  (default: 1)
      --timeout <ms>      Per-test packet-wait timeout    (default: 5000)
      --filter <id>       Run only tests whose ID contains this string
      --report <path>     Write a JSON conformance report to this file
  -v, --verbose           Show step-level pass/fail detail
      --no-color          Disable ANSI colours
  -h, --help              Show this message and exit

Exit codes
  0   All tests in scope passed
  1   One or more tests failed, or a fatal error occurred

Examples
  node index.js --endpoint tcp://localhost:4200
  node index.js --endpoint ws://localhost:4200 --level 2 --verbose
  node index.js --endpoint tcp://localhost:4200 --level 3 --report conformance.json
`);
    process.exit(argv.help ? 0 : 1);
  }

  const level = parseInt(argv.level, 10);
  if (isNaN(level) || level < 1 || level > 3) {
    console.error('Error: --level must be 1, 2, or 3');
    process.exit(1);
  }

  // --- Initialise XXH3-64 ---
  let h3_64;
  try {
    const xxhash = await require('xxhash-wasm')();
    h3_64 = xxhash.h3_64;
  } catch (err) {
    console.error('Fatal: failed to initialise xxhash-wasm:', err.message);
    console.error('Run `npm install` inside conformance/runner/ first.');
    process.exit(1);
  }

  // --- Load test cases ---
  const casesDir = path.resolve(__dirname, '..', 'cases');
  const files    = fs.readdirSync(casesDir)
    .filter(f => f.endsWith('.json'))
    .sort(); // lexicographic → L1-xxx before L2-xxx before L3-xxx

  const cases = [];
  for (const f of files) {
    try {
      const tc = JSON.parse(fs.readFileSync(path.join(casesDir, f), 'utf8'));
      if (typeof tc.level !== 'number') {
        console.warn(`Warning: ${f} has no 'level' field — skipping`);
        continue;
      }
      if (tc.level > level) continue;
      if (argv.filter && !tc.id.includes(argv.filter)) continue;
      cases.push(tc);
    } catch (err) {
      console.warn(`Warning: failed to load ${f}: ${err.message}`);
    }
  }

  if (cases.length === 0) {
    console.log('No test cases matched the given criteria.');
    process.exit(0);
  }

  // --- Run ---
  const { Executor } = require('./executor');
  const { Reporter } = require('./reporter');

  const executor = new Executor(argv.endpoint, h3_64);
  const reporter = new Reporter({ verbose: argv.verbose, noColor: argv['no-color'] });

  reporter.header(level, argv.endpoint);
  reporter.begin(cases.length);

  for (const tc of cases) {
    reporter.caseResult(await executor.runCase(tc));
  }

  const allPassed = reporter.summary();

  // --- Write report ---
  if (argv.report) {
    const report = reporter.toJSON();
    report.meta  = {
      endpoint:     argv.endpoint,
      level,
      spec_version: '1.0',
      runner:       'axon-conformance-runner@1.0.0',
    };
    fs.writeFileSync(argv.report, JSON.stringify(report, null, 2));
    console.log(`Report written to ${argv.report}`);
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err.stack || err.message);
  process.exit(1);
});