'use strict';

const { Transport }               = require('./lib/transport');
const { Connection, TestContext } = require('./context');
const { buildPacket, newSessionId, bufToUUID } = require('./packet');
const { SIGNAL, SIGNAL_NAME, FLAG, ERROR_CODE } = require('./constants');

class Executor {
  constructor(endpoint, h3_64) {
    this.endpoint = endpoint;
    this.h3_64    = h3_64;
  }

  // --- Case runner ---

  async runCase(tc) {
    const result = {
      id:          tc.id,
      level:       tc.level,
      description: tc.description,
      passed:      false,
      error:       null,
      steps:       [],
    };

    const ctx          = new TestContext();
    const allTransports = [];

    try {
      // Every test starts with a default connection to the implementation
      const defaultTransport = new Transport(this.h3_64);
      allTransports.push(defaultTransport);
      await defaultTransport.connect(this.endpoint);
      ctx.addConn('default', new Connection(defaultTransport));

      for (const step of tc.steps) {
        const sr = await this._runStep(step, ctx, allTransports);
        result.steps.push(sr);
        if (!sr.passed) {
          result.error = sr.error;
          return result;
        }
      }

      result.passed = true;
    } catch (err) {
      result.error = err.message;
    } finally {
      for (const t of allTransports) t.disconnect();
    }

    return result;
  }

  // --- Step dispatcher ---

  async _runStep(step, ctx, allTransports) {
    const sr = { action: step.action, passed: false, error: null };
    const handler = this[`_step_${step.action}`];
    if (!handler) {
      sr.error = `Unknown step action: '${step.action}'`;
      return sr;
    }
    try {
      await handler.call(this, step, ctx, allTransports);
      sr.passed = true;
    } catch (err) {
      sr.error = err.message;
    }
    return sr;
  }

  // --- Step: establish_session ---
  //
  // Runs a HANDSHAKE → HANDSHAKE_ACK exchange, capturing ctx_ref.
  // Handles a single counter-proposal from the responder.
  //
  // Options: namespace, codec, compression, metadata, schema_url,
  //          connection, as, timeout_ms

  async _step_establish_session(step, ctx) {
    const connName = step.connection || 'default';
    const conn     = ctx.getConn(connName);

    conn.session_id     = newSessionId();
    conn.session_id_str = bufToUUID(conn.session_id);

    const ns          = step.namespace    || 'org.axon.conformance';
    const codec       = step.codec        || 'json';
    const compression = step.compression  || 'none';

    const handshakePayload = { namespace: ns, codec, compression };
    if (step.metadata)   handshakePayload.metadata   = step.metadata;
    if (step.schema_url) handshakePayload.schema_url = step.schema_url;

    const seq = conn.nextSeq();
    conn.last_sent_seq = seq;

    conn.transport.send(buildPacket({
      session_id: conn.session_id,
      signal:     'HANDSHAKE',
      sequence:   seq,
      ctx_ref:    0,
      payload:    handshakePayload,
    }, this.h3_64));

    let resp = await conn.waitPacket(step.timeout_ms || 5000);

    // Handle counter-proposal: ctx_ref=0 in HANDSHAKE_ACK signals the
    // responder wants a different codec/compression.
    if (resp.signal === SIGNAL.HANDSHAKE_ACK && resp.payload_json?.ctx_ref === 0) {
      const proposed = resp.payload_json;
      const revisedPayload = {
        namespace:   ns,
        codec:       proposed.codec        || codec,
        compression: proposed.compression  || compression,
      };
      const seq2 = conn.nextSeq();
      conn.last_sent_seq = seq2;
      conn.transport.send(buildPacket({
        session_id: conn.session_id,
        signal:     'HANDSHAKE',
        sequence:   seq2,
        ctx_ref:    0,
        payload:    revisedPayload,
      }, this.h3_64));
      resp = await conn.waitPacket(step.timeout_ms || 5000);
    }

    if (resp.signal === SIGNAL.ERROR) {
      throw new Error(`HANDSHAKE rejected (ERROR ${resp.payload_json?.code}): ${resp.payload_json?.message ?? ''}`);
    }
    if (resp.signal !== SIGNAL.HANDSHAKE_ACK) {
      throw new Error(`Expected HANDSHAKE_ACK, got ${SIGNAL_NAME[resp.signal] ?? `0x${resp.signal.toString(16)}`}`);
    }

    const ctxRef = resp.payload_json?.ctx_ref ?? 0;
    if (ctxRef === 0) {
      throw new Error('HANDSHAKE_ACK returned ctx_ref=0, which is reserved and MUST NOT be issued (spec §01)');
    }
    conn.ctx_ref = ctxRef;

    // Store named template variables so subsequent steps can reference them
    const alias = step.as || connName;
    ctx.setVar(`${alias}_session_id_str`, conn.session_id_str);
    ctx.setVar(`${alias}_ctx_ref`,        conn.ctx_ref);
  }

  // --- Step: open_connection ---
  //
  // Opens an additional transport connection to the endpoint.
  // Required for FUSE tests that need two simultaneous sessions.
  //
  // Options: as (required)

  async _step_open_connection(step, ctx, allTransports) {
    const name = step.as;
    if (!name) throw new Error('open_connection requires an "as" parameter');
    const t = new Transport(this.h3_64);
    allTransports.push(t);
    await t.connect(this.endpoint);
    ctx.addConn(name, new Connection(t));
  }

  // --- Step: close_connection ---

  async _step_close_connection(step, ctx) {
    ctx.getConn(step.connection || 'default').transport.disconnect();
  }

  // --- Step: send ---
  //
  // Builds and transmits one AXON packet.
  //
  // Options: signal (required), payload, flags (array of flag names),
  //          connection, _ctx_ref, _session_id, _version, _magic,
  //          _stale_at (descriptor object — see _resolveStaleAt),
  //          _corrupt_checksum

  async _step_send(step, ctx) {
    const connName = step.connection || 'default';
    const conn     = ctx.getConn(connName);

    const session_id =
      step._session_id === 'random'    ? newSessionId()
      : step._session_id               ? Buffer.from(step._session_id, 'hex')
      : conn.session_id ?? newSessionId();

    const seq = conn.nextSeq();
    conn.last_sent_seq = seq;

    const ctx_ref = step._ctx_ref !== undefined ? step._ctx_ref : (conn.ctx_ref ?? 0);

    const resolvedPayload = step.payload ? ctx.resolvePayload(step.payload) : null;
    const stale_at        = step._stale_at != null ? this._resolveStaleAt(step._stale_at) : null;

    const magic =
      step._magic ? Buffer.from(step._magic, 'ascii') : undefined;

    conn.transport.send(buildPacket({
      magic,
      version:          step._version,
      session_id,
      signal:           step.signal,
      sequence:         seq,
      ctx_ref,
      flags:            step.flags,
      stale_at,
      payload:          resolvedPayload,
      corrupt_checksum: step._corrupt_checksum || false,
    }, this.h3_64));
  }

  // --- Step: send_raw ---
  //
  // Sends arbitrary raw bytes. Used for crafting intentionally malformed
  // packets (e.g., bad MAGIC, truncated headers).
  //
  // Options: data (hex string, required), connection

  async _step_send_raw(step, ctx) {
    const conn = ctx.getConn(step.connection || 'default');
    conn.transport.send(Buffer.from(step.data, 'hex'));
  }

  // --- Step: expect ---
  //
  // Waits for a packet and validates it.
  //
  // Options:
  //   signal          — required signal name or "*" for any
  //   error_code      — if signal=="ERROR", expected "0x0001"–"0x0007" code
  //   assert          — dict of dot-path → expected value or { not, nonzero, gt }
  //   assert_seq_ack  — if true, verify NUDGE seq_ack matches last sent sequence
  //   capture         — dict of dot-path → variable name to store
  //   timeout_ms      — default 3000
  //   connection

  async _step_expect(step, ctx) {
    const conn      = ctx.getConn(step.connection || 'default');
    const timeoutMs = step.timeout_ms || 3000;
    const pkt       = await conn.waitPacket(timeoutMs);

    // - Signal type check -
    if (step.signal && step.signal !== '*') {
      const expected = typeof step.signal === 'string'
        ? SIGNAL[step.signal]
        : step.signal;
      if (expected === undefined) throw new Error(`Unknown signal name: ${step.signal}`);
      if (pkt.signal !== expected) {
        const actual = SIGNAL_NAME[pkt.signal] ?? `0x${pkt.signal.toString(16).padStart(2,'0')}`;
        throw new Error(`Expected signal ${step.signal}, got ${actual}`);
      }
    }

    // - ERROR code check -
    if (step.signal === 'ERROR' && step.error_code !== undefined) {
      const actualCode   = pkt.payload_json?.code;
      const expectedCode = typeof step.error_code === 'number'
        ? `0x${step.error_code.toString(16).padStart(4, '0')}`
        : step.error_code;
      if (actualCode !== expectedCode) {
        throw new Error(`Expected ERROR code ${expectedCode}, got ${actualCode ?? '(none)'}`);
      }
    }

    // - NUDGE seq_ack verification -
    if (step.assert_seq_ack) {
      const seqAck = BigInt(pkt.payload_json?.seq_ack ?? -1);
      if (seqAck !== conn.last_sent_seq) {
        throw new Error(
          `NUDGE.seq_ack=${pkt.payload_json?.seq_ack} does not match last sent sequence ${conn.last_sent_seq}`
        );
      }
    }

    // - Arbitrary assertions -
    if (step.assert) {
      for (const [path, expected] of Object.entries(step.assert)) {
        this._assertPath(pkt, path, expected);
      }
    }

    // - Capture values -
    if (step.capture) {
      for (const [path, varName] of Object.entries(step.capture)) {
        ctx.setVar(varName, this._getPath(pkt, path));
      }
    }
  }

  // --- Step: expect_silence ---
  //
  // Waits `timeout_ms` and fails if any packet arrives.
  //
  // Options: timeout_ms (default 500), connection

  async _step_expect_silence(step, ctx) {
    const conn = ctx.getConn(step.connection || 'default');
    await conn.waitSilence(step.timeout_ms || 500);
  }

  // --- Step: release_session ---
  //
  // Sends RELEASE and waits for RELEASE_ACK.
  //
  // Options: reason_code (hex string, default "0x00"), connection, timeout_ms

  async _step_release_session(step, ctx) {
    const conn = ctx.getConn(step.connection || 'default');
    const seq  = conn.nextSeq();
    conn.last_sent_seq = seq;

    conn.transport.send(buildPacket({
      session_id: conn.session_id,
      signal:     'RELEASE',
      sequence:   seq,
      ctx_ref:    conn.ctx_ref,
      payload:    { reason_code: step.reason_code || '0x00' },
    }, this.h3_64));

    const resp = await conn.waitPacket(step.timeout_ms || 3000);
    if (resp.signal !== SIGNAL.RELEASE_ACK) {
      throw new Error(
        `Expected RELEASE_ACK, got ${SIGNAL_NAME[resp.signal] ?? `0x${resp.signal.toString(16)}`}`
      );
    }
  }

  // --- Helpers ---

  /**
   * Resolve a _stale_at descriptor into a BigInt suitable for buildPacket.
   *
   * Descriptor shapes:
   *   { type: "absolute", expired: true  }   →  Unix epoch 0 (always stale)
   *   { type: "absolute", expired: false }   →  100 years from now (never stale)
   *   { type: "relative", ms: 0 }            →  0x4000_0000_0000_0000 | 0n (instant expiry)
   *   { type: "relative", ms: N }            →  type=01 + N ms offset
   *   { type: "event",    topic: "a.b.c" }   →  type=10 + XXH3-64(topic) & low 62 bits
   *   { type: "manual"  }                    →  0xC000_0000_0000_0000 (never)
   *   "0x..." string or number               →  raw BigInt
   */
  _resolveStaleAt(d) {
    if (d === null || d === undefined) return null;
    if (typeof d === 'bigint')  return d;
    if (typeof d === 'number')  return BigInt(d);
    if (typeof d === 'string' && d.startsWith('0x')) return BigInt(d);

    switch (d.type) {
      case 'absolute':
        if (d.expired) return 0n;
        return BigInt(Date.now() + 100 * 365 * 24 * 3600 * 1000);

      case 'relative':
        return 0x4000000000000000n | BigInt(d.ms ?? 0);

      case 'event': {
        const hexStr = this.h3_64(Buffer.from(d.topic, 'utf8'));
        const hash   = BigInt('0x' + hexStr) & 0x3FFFFFFFFFFFFFFFn;
        return 0x8000000000000000n | hash;
      }

      case 'manual':
        return 0xC000000000000000n;

      default:
        throw new Error(`Unknown _stale_at type: '${d.type}'`);
    }
  }

  _getPath(obj, path) {
    return path.split('.').reduce((acc, k) => acc?.[k], obj);
  }

  _assertPath(obj, path, expected) {
    const actual = this._getPath(obj, path);

    // Structured operator
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('not' in expected) {
        if (actual === expected.not)
          throw new Error(`Assert [${path}]: expected NOT ${JSON.stringify(expected.not)}, but got it`);
        return;
      }
      if (expected.nonzero) {
        if (!actual)
          throw new Error(`Assert [${path}]: expected a non-zero/truthy value, got ${JSON.stringify(actual)}`);
        return;
      }
      if ('gt' in expected) {
        if (!(actual > expected.gt))
          throw new Error(`Assert [${path}]: expected > ${expected.gt}, got ${JSON.stringify(actual)}`);
        return;
      }
    }

    // Plain equality
    if (actual !== expected) {
      throw new Error(`Assert [${path}]: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
}

module.exports = { Executor };