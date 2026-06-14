# AXON Protocol — Wiki

Welcome to the AXON Protocol documentation. This wiki covers the normative specification, implementation guidance, and reference material for the AXON binary transport protocol.

For a high-level overview, start with the README. For everything else, use the index below.

---

## Specification

These pages are normative. Language follows RFC conventions: **MUST** / **MUST NOT** for absolute requirements, **SHOULD** / **SHOULD NOT** for strong recommendations, **MAY** for optional behaviour.

| Page | Contents |
|------|----------|
| [Packet Structure](https://github.com/axon-prot/spec/blob/master/spec/01-packet-structure.md) | Binary format, all field definitions, FLAGS breakdown, STALE_AT encoding, checksum computation |
| [Signal Reference](https://github.com/axon-prot/spec/blob/master/spec/02-signals.md) | All 15 signal types with codes, payload schemas, valid session states, and expected responses |
| [Session Lifecycle](https://github.com/axon-prot/spec/blob/master/spec/03-session-lifecycle.md) | Session state machine, state transition rules, connection flow diagrams |
| [Semantic Expiry](https://github.com/axon-prot/spec/blob/master/spec/04-semantic-expiry.md) | STALE_AT field format, the four expiry types, event-based expiry, interaction with REVOKE |
| [Context Bundles](https://github.com/axon-prot/spec/blob/master/spec/05-context-bundles.md) | The shared session namespace established during HANDSHAKE; schema, auth, and codec negotiation |

---

## Implementation

| Page | Contents |
|------|----------|
| [Implementation Guide](https://github.com/axon-prot/spec/blob/master/spec/06-implementation-guide.md) | How to build an AXON node; conformance levels; minimum viable implementation; common pitfalls |

---

## Quick Reference

### Signal codes

| Code | Name | Category |
|------|------|----------|
| 0x01 | PROBE | discovery |
| 0x02 | PROBE_ACK | discovery |
| 0x03 | HANDSHAKE | session |
| 0x04 | HANDSHAKE_ACK | session |
| 0x05 | PUSH | data |
| 0x06 | PULL | data |
| 0x07 | CAST | data |
| 0x08 | SYNC | data |
| 0x09 | FUSE | advanced |
| 0x0A | FUSE_ACK | advanced |
| 0x0B | NUDGE | control |
| 0x0C | REVOKE | control |
| 0x0D | RELEASE | session |
| 0x0E | RELEASE_ACK | session |
| 0xFF | ERROR | control |

### Packet header size

| Condition | Size |
|-----------|------|
| No payload, no STALE_AT | 48 bytes |
| No payload, with STALE_AT | 56 bytes |
| N-byte payload, no STALE_AT | 48 + N bytes |
| N-byte payload, with STALE_AT | 56 + N bytes |

### Error codes

| Code | Meaning |
|------|---------|
| 0x0001 | Version mismatch (unsupported major version) |
| 0x0002 | Unknown signal type |
| 0x0003 | Oversized payload |
| 0x0004 | Invalid Context Bundle reference (unknown ctx_ref) |
| 0x0005 | Malformed packet (checksum failure or truncated header) |
| 0x0006 | Signal not valid in current session state |
| 0x0007 | FUSE target session not found |
