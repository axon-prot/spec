'use strict';

const { SIGNAL_NAME } = require('./constants');

// --- Connection ---

/**
 * Wraps a Transport, tracking per-session state and providing promise-based
 * packet reception with timeouts.
 */
class Connection {
  constructor(transport) {
    this.transport     = transport;
    this.session_id    = null;   // Buffer (16 bytes)
    this.session_id_str = null;  // "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    this.ctx_ref       = null;
    this.sequence      = 1n;
    this.last_sent_seq = null;

    this._queue   = [];  // packets received while nobody is waiting
    this._waiters = [];  // { onPacket } callbacks

    transport.on('packet', pkt => this._push(pkt));
  }

  nextSeq() {
    const s = this.sequence;
    this.sequence += 1n;
    return s;
  }

  _push(pkt) {
    if (this._waiters.length > 0) {
      this._waiters.shift().onPacket(pkt);
    } else {
      this._queue.push(pkt);
    }
  }

  _removeWaiter(w) {
    const i = this._waiters.indexOf(w);
    if (i !== -1) this._waiters.splice(i, 1);
  }

  /**
   * Resolve with the next incoming packet, or reject on timeout.
   * @param {number} [timeoutMs=3000]
   */
  waitPacket(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      if (this._queue.length > 0) return resolve(this._queue.shift());

      let w;
      const timer = setTimeout(() => {
        this._removeWaiter(w);
        reject(new Error(`Timeout: no packet received within ${timeoutMs}ms`));
      }, timeoutMs);

      w = {
        onPacket(pkt) {
          clearTimeout(timer);
          resolve(pkt);
        },
      };
      this._waiters.push(w);
    });
  }

  /**
   * Resolve after `timeoutMs` of silence, or reject immediately if a packet
   * arrives. Confirms the implementation did NOT send a response.
   * @param {number} [timeoutMs=500]
   */
  waitSilence(timeoutMs = 500) {
    return new Promise((resolve, reject) => {
      if (this._queue.length > 0) {
        const pkt  = this._queue.shift();
        const name = SIGNAL_NAME[pkt.signal] ?? `0x${pkt.signal.toString(16).padStart(2, '0')}`;
        return reject(new Error(`Expected silence but received ${name}`));
      }

      let w;
      const timer = setTimeout(() => {
        this._removeWaiter(w);
        resolve();
      }, timeoutMs);

      w = {
        onPacket(pkt) {
          clearTimeout(timer);
          const name = SIGNAL_NAME[pkt.signal] ?? `0x${pkt.signal.toString(16).padStart(2, '0')}`;
          reject(new Error(`Expected silence but received ${name}`));
        },
      };
      this._waiters.push(w);
    });
  }
}

// --- TestContext ---

/**
 * Per-test-case context. Holds all named connections and template variables.
 */
class TestContext {
  constructor() {
    this._connections = new Map(); // name → Connection
    this.vars         = new Map(); // template variable name → value
  }

  addConn(name, conn) {
    this._connections.set(name, conn);
  }

  getConn(name = 'default') {
    const conn = this._connections.get(name);
    if (!conn) throw new Error(`No connection named '${name}'`);
    return conn;
  }

  setVar(key, value) { this.vars.set(key, value); }
  getVar(key)        { return this.vars.get(key); }

  /**
   * Recursively substitute "$varName" strings in a payload tree.
   * Throws if a referenced variable is not set.
   */
  resolvePayload(payload) {
    if (payload === null || payload === undefined) return payload;
    if (typeof payload === 'string') {
      if (!payload.startsWith('$')) return payload;
      const key = payload.slice(1);
      if (!this.vars.has(key)) throw new Error(`Undefined template variable: ${payload}`);
      return this.vars.get(key);
    }
    if (Array.isArray(payload)) return payload.map(v => this.resolvePayload(v));
    if (typeof payload === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(payload)) out[k] = this.resolvePayload(v);
      return out;
    }
    return payload;
  }
}

module.exports = { Connection, TestContext };