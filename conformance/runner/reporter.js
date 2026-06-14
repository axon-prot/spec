'use strict';

const R = '\x1b[0m';
const G = '\x1b[32m';
const Y = '\x1b[33m';
const RD = '\x1b[31m';
const B = '\x1b[1m';
const D = '\x1b[2m';

class Reporter {
  constructor(opts = {}) {
    this.verbose = opts.verbose || false;
    this.plain   = opts.noColor || !process.stdout.isTTY;
    this.results = [];
    this._levelResults = { 1: [], 2: [], 3: [] };
  }

  _c(code, str) { return this.plain ? str : code + str + R; }

  header(level, endpoint) {
    const line = '─'.repeat(60);
    console.log('');
    console.log(this._c(B, 'AXON Protocol Conformance Suite'));
    console.log(`${this._c(D, 'Spec:')} v1.0  ${this._c(D, 'Level:')} ${level}  ${this._c(D, 'Endpoint:')} ${endpoint}`);
    console.log(line);
  }

  begin(count) {
    console.log(`Running ${count} test ${count === 1 ? 'case' : 'cases'}...\n`);
  }

  caseResult(result) {
    this.results.push(result);
    this._levelResults[result.level]?.push(result);

    const icon = result.passed ? this._c(G, '✓') : this._c(RD, '✗');
    const id   = this._c(D, `[${result.id}]`);
    console.log(`  ${icon} ${id} ${result.description}`);

    if (!result.passed && result.error) {
      console.log(`      ${this._c(RD, '↳')} ${result.error}`);
    }

    if (this.verbose) {
      for (const s of result.steps) {
        const si = s.passed ? this._c(G, '·') : this._c(RD, '!');
        const detail = s.error ? `: ${s.error}` : '';
        console.log(`        ${si} ${s.action}${detail}`);
      }
    }
  }

  summary() {
    const total  = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;
    const line   = '─'.repeat(60);

    console.log(`\n${line}`);

    // Per-level breakdown
    for (const lv of [1, 2, 3]) {
      const lr = this._levelResults[lv];
      if (!lr || lr.length === 0) continue;
      const lp = lr.filter(r => r.passed).length;
      const col = lp === lr.length ? G : (lp === 0 ? RD : Y);
      console.log(`  ${this._c(D, `Level ${lv}:`)} ${this._c(col, `${lp}/${lr.length} passed`)}`);
    }

    console.log('');

    if (failed === 0) {
      console.log(`  ${this._c(G, B + `✓ All ${total} tests passed` + R)}`);
    } else {
      console.log(`  ${this._c(RD, `${failed} test${failed > 1 ? 's' : ''} failed`)}`);
      console.log(`\n  ${this._c(B, 'Failed cases:')}`);
      for (const r of this.results.filter(r => !r.passed)) {
        console.log(`    ${this._c(RD, r.id)}: ${r.description}`);
        if (r.error) console.log(`      ${this._c(D, '↳')} ${r.error}`);
      }
    }

    console.log('');
    return failed === 0;
  }

  toJSON() {
    const passed = this.results.filter(r => r.passed).length;
    return {
      summary: {
        total:     this.results.length,
        passed,
        failed:    this.results.length - passed,
        timestamp: new Date().toISOString(),
      },
      cases: this.results.map(r => ({
        id:          r.id,
        level:       r.level,
        description: r.description,
        passed:      r.passed,
        error:       r.error || null,
        steps:       r.steps.map(s => ({
          action: s.action,
          passed: s.passed,
          error:  s.error || null,
        })),
      })),
    };
  }
}

module.exports = { Reporter };