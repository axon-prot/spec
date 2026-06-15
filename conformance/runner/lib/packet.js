'use strict';

const crypto = require('crypto');
const { MAGIC, VERSION, SIGNAL, FLAG } = require('./lib/constants');

// --- UUID helpers ---

function newSessionId() {
  const buf = crypto.randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant 10xx
  return buf;
}

function bufToUUID(buf) {
  const h = buf.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function uuidToBuf(str) {
  return Buffer.from(str.replace(/-/g, ''), 'hex');
}

// --- u56 big-endian helpers ---

function writeU56BE(buf, offset, value) {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  for (let i = 6; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xFFn);
    v >>= 8n;
  }
}

function readU56BE(buf, offset) {
  let v = 0n;
  for (let i = 0; i < 7; i++) v = (v << 8n) | BigInt(buf[offset + i]);
  return v;
}

// --- Flag resolution ---

function resolveFlags(flagsInput) {
  if (!flagsInput) return 0;
  if (typeof flagsInput === 'number') return flagsInput;
  if (Array.isArray(flagsInput)) {
    let f = 0;
    for (const name of flagsInput) {
      if (FLAG[name] === undefined) throw new Error(`Unknown flag: ${name}`);
      f |= FLAG[name];
    }
    return f;
  }
  throw new Error(`Invalid flags: ${JSON.stringify(flagsInput)}`);
}

function resolveSignal(signalInput) {
  if (typeof signalInput === 'number') return signalInput;
  const code = SIGNAL[signalInput];
  if (code === undefined) throw new Error(`Unknown signal: ${signalInput}`);
  return code;
}

// --- Packet builder ---

/**
 * Build an AXON binary packet.
 *
 * @param {object} opts
 * @param {Buffer}         [opts.magic]            Override MAGIC (4 bytes). Default: "AXON".
 * @param {number[]}       [opts.version]          [major, minor]. Default: [1, 0].
 * @param {number|string[]} [opts.flags]           Flag bitfield or array of flag names.
 * @param {Buffer}          opts.session_id        16-byte session UUID.
 * @param {number|string}   opts.signal            Signal code or name.
 * @param {bigint|number}  [opts.sequence]         Per-session monotonic counter. Default: 1n.
 * @param {number}         [opts.ctx_ref]          Context Bundle handle. Default: 0.
 * @param {bigint|null}    [opts.stale_at]         STALE_AT value. Sets HAS_STALE_AT flag.
 * @param {Buffer|object|string|null} [opts.payload] Payload. Objects are JSON-stringified.
 * @param {boolean}        [opts.corrupt_checksum] Intentionally corrupt the checksum.
 * @param {function}        h3_64                  XXH3-64 function: (Uint8Array) → hex string.
 * @returns {Buffer}
 */
function buildPacket(opts, h3_64) {
  const {
    session_id,
    signal,
    sequence  = 1n,
    ctx_ref   = 0,
    stale_at  = null,
    payload   = null,
    corrupt_checksum = false,
  } = opts;

  let flags   = resolveFlags(opts.flags);
  const magic   = opts.magic ?? MAGIC;
  const version = opts.version ?? [VERSION.major, VERSION.minor];
  const sigByte = resolveSignal(signal);

  // Encode payload
  let payloadBuf;
  if (payload === null || payload === undefined) {
    payloadBuf = Buffer.alloc(0);
  } else if (Buffer.isBuffer(payload)) {
    payloadBuf = payload;
  } else if (typeof payload === 'string') {
    payloadBuf = Buffer.from(payload, 'utf8');
  } else {
    payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  }

  // STALE_AT presence
  const hasStaleAt = stale_at !== null;
  if (hasStaleAt) flags |= FLAG.HAS_STALE_AT;

  // Compute layout offsets
  const payloadLenOffset = hasStaleAt ? 44 : 36;
  const payloadOffset    = payloadLenOffset + 4;
  const checksumOffset   = payloadOffset + payloadBuf.length;
  const totalLen         = checksumOffset + 8;

  const buf = Buffer.alloc(totalLen, 0);

  // Write fields
  magic.copy(buf, 0);
  buf[4] = version[0];
  buf[5] = version[1];
  buf.writeUInt16BE(flags, 6);
  session_id.copy(buf, 8);
  buf[24] = sigByte;
  writeU56BE(buf, 25, sequence);
  buf.writeUInt32BE(ctx_ref >>> 0, 32);

  if (hasStaleAt) {
    buf.writeBigUInt64BE(typeof stale_at === 'bigint' ? stale_at : BigInt(stale_at), 36);
  }

  buf.writeUInt32BE(payloadBuf.length, payloadLenOffset);
  payloadBuf.copy(buf, payloadOffset);

  // Compute and write checksum
  const hexStr   = h3_64(new Uint8Array(buf.buffer, buf.byteOffset, checksumOffset));
  let   checksum = BigInt('0x' + hexStr);
  if (corrupt_checksum) checksum ^= 0xDEADBEEFCAFEBABEn;
  buf.writeBigUInt64BE(checksum, checksumOffset);

  return buf;
}

// --- Stream framer ---

/**
 * Try to extract one complete AXON packet from a stream buffer.
 * Returns { packet, remainder } or null if not enough bytes yet.
 */
function tryFrame(buf) {
  if (buf.length < 8) return null;

  const flags      = buf.readUInt16BE(6);
  const hasStaleAt = !!(flags & FLAG.HAS_STALE_AT);
  const plLenOff   = hasStaleAt ? 44 : 36;

  if (buf.length < plLenOff + 4) return null;

  const payloadLen = buf.readUInt32BE(plLenOff);
  const totalLen   = plLenOff + 4 + payloadLen + 8;

  if (buf.length < totalLen) return null;

  return { packet: buf.slice(0, totalLen), remainder: buf.slice(totalLen) };
}

// --- Packet parser ---

/**
 * Parse a complete AXON packet buffer into a structured object.
 * Does not throw; populates checksumValid for the caller to act on.
 */
function parsePacket(buf, h3_64) {
  const flags      = buf.readUInt16BE(6);
  const hasStaleAt = !!(flags & FLAG.HAS_STALE_AT);
  const plLenOff   = hasStaleAt ? 44 : 36;
  const payloadLen = buf.readUInt32BE(plLenOff);
  const plOff      = plLenOff + 4;
  const csOff      = plOff + payloadLen;

  // Verify checksum
  const computedHex  = h3_64(new Uint8Array(buf.buffer, buf.byteOffset, csOff));
  const storedBig    = buf.readBigUInt64BE(csOff);
  const storedHex    = storedBig.toString(16).padStart(16, '0');
  const checksumValid = computedHex === storedHex;

  const payload = buf.slice(plOff, csOff);
  let payload_json = null;
  if (payloadLen > 0) {
    try { payload_json = JSON.parse(payload.toString('utf8')); } catch {}
  }

  return {
    magicOk:   buf[0] === 0x41 && buf[1] === 0x58 && buf[2] === 0x4F && buf[3] === 0x4E,
    version:   { major: buf[4], minor: buf[5] },
    flags,
    session_id: buf.slice(8, 24),
    signal:    buf[24],
    sequence:  readU56BE(buf, 25),
    ctx_ref:   buf.readUInt32BE(32),
    stale_at:  hasStaleAt ? buf.readBigUInt64BE(36) : null,
    payload,
    payload_json,
    checksum:  storedBig,
    checksumValid,
    raw:       buf,
  };
}

module.exports = { newSessionId, bufToUUID, uuidToBuf, buildPacket, tryFrame, parsePacket };
