# AXON Protocol

**AXON** (Adaptive eXchange Over Negotiated-context) is an open, binary, full-duplex data transport protocol. It runs over any reliable transport (TCP, TLS, QUIC), negotiates encoding and compression per session, and is built around six properties that existing protocols leave entirely to application code.

This repository contains the canonical AXON protocol specification, conformance suite, schemas, and supporting documentation. Development is coordinated through the `axon-prot` Github organisation.

---

## Why AXON?

| The gap | Existing answer | AXON answer |
|---|---|---|
| Which node can handle this request? | Static config / service registry | `PROBE` — nodes broadcast capabilities; peers self-select |
| Is this data still relevant? | `Cache-Control` (time only) | `STALE_AT` — expiry by timestamp, relative offset, or event hash |
| Can I merge two live streams? | Reconnect / proxy layer | `FUSE` — merge live sessions without disconnecting |
| Can I cancel an in-flight request? | TCP teardown / custom flag | `REVOKE` — forward-cancel unprocessed packets by sequence number |
| How do I reconcile distributed state? | Poll / external etcd or Consul | `SYNC` — Merkle-digest reconciliation as a built-in signal |
| How do I broadcast to subscribers? | Separate broker (MQTT, Redis) | `CAST` — fanout at relay nodes, no broker required |

---

## Features

- **Capability addressing** via `PROBE` / `PROBE_ACK` — connect to what you need, not where it lives
- **Living context** — sessions carry a shared namespace and schema reference, referenced by a 4-byte `CTX_REF` handle in every packet after the initial handshake
- **Semantic expiry** — `STALE_AT` encodes expiry as an absolute timestamp, a relative offset, or the hash of a future event
- **Session fusion** — `FUSE` merges two independent sessions into a unified context stream at runtime
- **State sync** — `SYNC` reconciles diverged state via Merkle digests without polling
- **Data revocation** — `REVOKE` forward-cancels unprocessed data by sequence number
- **15 signal types** across discovery, session, data, advanced, and control categories
- **Transport-agnostic** — framing is independent of the underlying transport layer
- **Per-session codec negotiation** — JSON, MessagePack, CBOR, Protobuf, FlatBuffers, or raw binary

---

## Wire Format

All AXON packets share a fixed binary header (big-endian). The `STALE_AT` field is present only when the `HAS_STALE_AT` flag is set.

```
Offset   Field          Size    Notes
──────────────────────────────────────────────────────────────────
 0       MAGIC           4 B    0x41 0x58 0x4F 0x4E  ("AXON")
 4       VERSION         2 B    Major · Minor
 6       FLAGS           2 B    16-bit feature flags
 8       SESSION_ID     16 B    UUID v4
24       SIGNAL          1 B    Signal type (0x01–0xFF)
25       SEQUENCE        7 B    56-bit monotonic counter
32       CTX_REF         4 B    Context Bundle handle (uint32)
[36]     STALE_AT        8 B    Conditional — present when HAS_STALE_AT flag is set
[36|44]  PAYLOAD_LEN     4 B    uint32 payload byte count
[40|48]  PAYLOAD         N B    Codec-encoded data
[40+N]   CHECKSUM        8 B    XXH3-64 of all preceding bytes
──────────────────────────────────────────────────────────────────
Minimum packet (no payload, no STALE_AT): 48 bytes
```

See [Packet Structure](https://github.com/axon-prot/spec/blob/master/spec/01-packet-structure.md) for field descriptions, the FLAGS breakdown, and STALE_AT encoding.

---

## Signals

| Code  | Name          | Category  | Description                                       |
|-------|---------------|-----------|---------------------------------------------------|
| 0x01  | PROBE         | discovery | Discover peer capabilities                        |
| 0x02  | PROBE_ACK     | discovery | Respond with capability advertisement             |
| 0x03  | HANDSHAKE     | session   | Initiate session with Context Bundle proposal     |
| 0x04  | HANDSHAKE_ACK | session   | Accept or counter-propose session parameters      |
| 0x05  | PUSH          | data      | Send data, optionally acknowledged                |
| 0x06  | PULL          | data      | Request data by query or sequence reference       |
| 0x07  | CAST          | data      | Broadcast to all topic subscribers                |
| 0x08  | SYNC          | data      | Reconcile state via Merkle digest exchange        |
| 0x09  | FUSE          | advanced  | Merge two sessions into one unified stream        |
| 0x0A  | FUSE_ACK      | advanced  | Confirm session fusion                            |
| 0x0B  | NUDGE         | control   | Lightweight keepalive with optional payload (≤64 B)|
| 0x0C  | REVOKE        | control   | Invalidate data by sequence number reference      |
| 0x0D  | RELEASE       | session   | Gracefully terminate the session                  |
| 0x0E  | RELEASE_ACK   | session   | Confirm termination                               |
| 0xFF  | ERROR         | control   | Signal an unrecoverable error                     |

Full descriptions, payload schemas, and valid-state constraints: [Signal Reference](https://github.com/axon-prot/spec/blob/master/spec/02-signals.md).

---

## Repository Structure

This repository (`spec`) is the canonical specification repository within the `axon-prot` Github organisation.

```text
spec/
├── spec/                    Normative specification documents
│   └── ...
├── conformance/             Transport-agnostic conformance test suite
│   ├── cases/               Test case definitions (JSON)
│   └── runner/              Reference test runner (Node.js)
└── schemas/                 Formal schemas for structured payloads
    ├── capability-descriptor.json
    └── context-bundle.json
```

The broader project is organised under the `axon-prot` Github organisation, while this repository contains the specification, schemas, examples, and conformance materials that define the AXON protocol.

---

## License

The AXON Protocol Specification is released under the [MIT License](LICENSE).