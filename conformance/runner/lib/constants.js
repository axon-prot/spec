'use strict';

const MAGIC = Buffer.from([0x41, 0x58, 0x4F, 0x4E]); // "AXON"
const VERSION = { major: 1, minor: 0 };

const SIGNAL = {
  PROBE:         0x01,
  PROBE_ACK:     0x02,
  HANDSHAKE:     0x03,
  HANDSHAKE_ACK: 0x04,
  PUSH:          0x05,
  PULL:          0x06,
  CAST:          0x07,
  SYNC:          0x08,
  FUSE:          0x09,
  FUSE_ACK:      0x0A,
  NUDGE:         0x0B,
  REVOKE:        0x0C,
  RELEASE:       0x0D,
  RELEASE_ACK:   0x0E,
  ERROR:         0xFF,
};

const SIGNAL_NAME = Object.fromEntries(
  Object.entries(SIGNAL).map(([k, v]) => [v, k])
);

const FLAG = {
  COMPRESSED:        0x0001,
  ENCRYPTED:         0x0002,
  HAS_STALE_AT:      0x0004,
  FRAGMENTED:        0x0008,
  LAST_FRAGMENT:     0x0010,
  PRIORITY_HIGH:     0x0020,
  PRIORITY_CRITICAL: 0x0040,
  REQUIRES_ACK:      0x0080,
  CHILD_SESSION:     0x0100,
  FUSED:             0x0200,
};

const ERROR_CODE = {
  VERSION_MISMATCH:      0x0001,
  UNKNOWN_SIGNAL:        0x0002,
  OVERSIZED_PAYLOAD:     0x0003,
  INVALID_CTX_REF:       0x0004,
  MALFORMED_PACKET:      0x0005,
  INVALID_STATE:         0x0006,
  FUSE_TARGET_NOT_FOUND: 0x0007,
};

module.exports = { MAGIC, VERSION, SIGNAL, SIGNAL_NAME, FLAG, ERROR_CODE };
