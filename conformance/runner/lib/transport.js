'use strict';

const net          = require('net');
const EventEmitter = require('events');
const { tryFrame, parsePacket } = require('../packet');

/**
 * Bidirectional AXON transport supporting tcp:// and ws:// endpoints.
 *
 * Events:
 *   'packet'      (pkt)  — a complete, parsed AXON packet was received
 *   'parse_error' (err)  — a received buffer could not be parsed
 *   'close'              — the underlying connection closed
 */
class Transport extends EventEmitter {
  constructor(h3_64) {
    super();
    this._h3_64  = h3_64;
    this._socket = null;
    this._ws     = null;
    this._buf    = Buffer.alloc(0);
  }

  async connect(endpoint) {
    const url = new URL(endpoint);
    if (url.protocol === 'tcp:') {
      await this._connectTCP(url.hostname, parseInt(url.port, 10));
    } else if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      await this._connectWS(endpoint);
    } else {
      throw new Error(`Unsupported transport protocol: ${url.protocol}`);
    }
  }

  async _connectTCP(host, port) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      sock.once('connect', () => { this._socket = sock; resolve(); });
      sock.once('error',   reject);
      sock.on('data',  chunk => this._feed(chunk));
      sock.on('close', ()    => this.emit('close'));
    });
  }

  async _connectWS(url) {
    // ws is an optional dependency; lazy-require so tcp-only users don't need it
    const { WebSocket } = require('ws');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'nodebuffer';
      ws.once('open',  ()   => { this._ws = ws; resolve(); });
      ws.once('error', reject);
      ws.on('message', data => this._feed(Buffer.isBuffer(data) ? data : Buffer.from(data)));
      ws.on('close',   ()   => this.emit('close'));
    });
  }

  _feed(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    let result;
    while ((result = tryFrame(this._buf)) !== null) {
      this._buf = result.remainder;
      try {
        this.emit('packet', parsePacket(result.packet, this._h3_64));
      } catch (err) {
        this.emit('parse_error', err);
      }
    }
  }

  /** Send a raw buffer. */
  send(buf) {
    if (this._socket) { this._socket.write(buf); return; }
    if (this._ws)     { this._ws.send(buf);      return; }
    throw new Error('Transport is not connected');
  }

  disconnect() {
    this._socket?.destroy();
    this._ws?.terminate();
    this._socket = null;
    this._ws     = null;
    this._buf    = Buffer.alloc(0);
  }
}

module.exports = { Transport };