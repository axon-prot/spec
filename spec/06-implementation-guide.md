# Implementation Guide

This page covers what you need to build a conformant AXON node, how to test it, and the conventions shared across all official implementation repositories.

---

## Repository Organisation

The AXON project uses a multi-repo structure under the `axon-prot` GitHub organisation:

| Repository | Contents |
|------------|----------|
| [`axon-protocol/spec`](https://github.com/axon-prot/spec) | Normative specification, conformance suite, schemas. The source of truth. |
| `axon-protocol/axon-rs` | Rust reference implementation |
| `axon-protocol/axon-js` | Node.js and browser library |
| `axon-protocol/axon-go` | Go implementation |
| `axon-protocol/axon-py` | Python implementation |
| `axon-protocol/axon-cs` | C# implementation |

Implementation repositories do not contain copies of the spec. They reference the conformance suite from `spec` directly to ensure they always test against the current normative text. If you are building an implementation in a language not listed above, you are welcome to publish it under your own namespace and open an issue in `spec` to have it listed here.

---

## Conformance Levels

Implementations declare a conformance level that indicates which signals and features they support. Higher levels are strict supersets of lower ones.

### Level 1 — Core

Sufficient for simple point-to-point data exchange with a known peer.

Required signals: `HANDSHAKE`, `HANDSHAKE_ACK`, `PUSH`, `RELEASE`, `RELEASE_ACK`, `ERROR`, `NUDGE`

* Static configuration is acceptable; `PROBE` is not required.
* `STALE_AT` types `00` and `01` (absolute and relative) MUST be supported.
* `STALE_AT` type `10` (event hash) MAY be omitted; if omitted, the implementation MUST document this and treat type-10 packets as non-expiring.
* Session state machine MUST be enforced (ERROR `0x0006` on invalid-state signals).
* Checksum verification MUST be implemented.

### Level 2 — Standard

Adds capability discovery, pub/sub, and data revocation. Sufficient for most production use cases.

Required additions: `PROBE`, `PROBE_ACK`, `PULL`, `CAST`, `REVOKE`

* `PROBE` responses MUST include at least `provides`, `codecs`, and `version`.
* `CAST` MUST be delivered to all subscribers of the named topic within a session. Relay behaviour for cross-session fanout is OPTIONAL at this level.
* `REVOKE` MUST discard the referenced packet if it has not yet been passed to the application layer.

### Level 3 — Full

Adds state synchronisation and session fusion. Suitable for distributed systems requiring strong consistency guarantees.

Required additions: `SYNC`, `FUSE`, `FUSE_ACK`

* `SYNC` MUST implement Merkle-digest comparison and trigger a delta PUSH exchange when digests differ.
* `FUSE` MUST enforce the namespace-match requirement and reject mismatches with ERROR `0x0007`.
* `CHILD_SESSION` and `FUSED` flags MUST be correctly set and respected.
* Event-hash STALE_AT (type `10`) MUST be supported.

---

## Minimum Viable Implementation Checklist

Use this as a starting point for a Level 1 implementation:

### Packet I/O

* [ ] Read the MAGIC field first; drop packets that do not match `0x41584F4E`
* [ ] Verify major VERSION; send ERROR `0x0001` on mismatch
* [ ] Verify CHECKSUM (XXH3-64) before any other processing; send ERROR `0x0005` on failure
* [ ] Parse FLAGS correctly; ignore reserved bits (10–15) without error
* [ ] Handle STALE_AT when `HAS_STALE_AT` flag is set; discard expired packets silently
* [ ] Compute and write CHECKSUM on all outbound packets

### Session Management

* [ ] Assign a UUID v4 SESSION_ID at HANDSHAKE
* [ ] Allocate a non-zero CTX_REF and return it in HANDSHAKE_ACK
* [ ] Maintain per-session SEQUENCE counter; never reset within a session
* [ ] Enforce the session state machine; emit ERROR `0x0006` for invalid-state signals
* [ ] Handle simultaneous RELEASE (crossing close) gracefully

### Signals

* [ ] Implement all Level 1 required signals
* [ ] Respond to unknown signal codes with ERROR `0x0002`
* [ ] Handle NUDGE as both keepalive and implicit ACK
* [ ] Respect `REQUIRES_ACK` flag; send NUDGE with `seq_ack` when set

### Error Handling

* [ ] Transition to ERROR state on receiving ERROR; do not send further signals
* [ ] On sending ERROR, transition to ERROR state immediately after
* [ ] Log the diagnostic `message` field from incoming ERROR payloads

---

## Running the Conformance Suite

The conformance suite lives in `spec/conformance/` and is transport-agnostic. It connects to your implementation over the transport it natively supports and drives it through a sequence of test exchanges.

```bash
git clone https://github.com/axon-prot/spec.git cd spec/conformance/runner npm install npm test -- --level 1 --endpoint tcp://localhost:4200
```

Options:

| Flag | Description |
|------|-------------|
| `--level <n>` | Conformance level to test (1, 2, or 3). Defaults to 1. |
| `--endpoint <url>` | Transport endpoint for your implementation. |
| `--timeout <ms>` | Per-test timeout. Defaults to 5000. |
| `--report <path>` | Write a JSON conformance report to this path. |

The runner exits with code 0 on full pass and non-zero on any failure. CI integration is straightforward:

```
# Example GitLab CI job conformance: stage: test script: - npm test -- --level 2 --endpoint tcp://localhost:4200 --report conformance.json artifacts: paths: [conformance.json]
```

---

## Relay / Intermediary Nodes

An AXON relay node forwards packets between sessions without participating in them as an endpoint. Relay nodes have specific constraints:

**MUST:**

* Route packets using SESSION_ID as the sole key
* Forward packets with all fields unchanged (no field modification of any kind)
* Maintain per-SESSION_ID routing tables
* Forward ERROR signals and begin removing the session from routing tables on receipt

**MUST NOT:**

* Inspect the SIGNAL field to make routing decisions
* Decrypt ENCRYPTED payloads
* Modify, strip, or rewrite any header field
* Generate AXON signals of their own (except when participating in session establishment as an endpoint on a separate session)

Relay nodes that implement CAST fanout additionally MUST maintain a topic-to-session subscription map and forward CAST packets to all subscribed sessions.

---

## Common Pitfalls

**Resetting SEQUENCE between sessions.** The SEQUENCE counter is per-session, not per-connection. A new session on a reused connection gets a fresh SEQUENCE starting at `0x000000000000001`. Never carry the counter over.

**Allocating CTX_REF `0x00000000`.** This value is reserved. An implementation that issues it will cause compliant peers to send ERROR `0x0004` immediately.

**Sending ERROR and continuing.** The moment you send or receive an ERROR, the session is in the ERROR state. No further signals are valid. Implementations that catch and recover from ERRORs within a session are non-conformant.

**Dropping unknown signal codes silently.** Unknown signal codes MUST produce ERROR `0x0002`. Silent drops make debugging across implementations nearly impossible.

**Ignoring STALE_AT on inbound packets.** If a packet has `HAS_STALE_AT` set and the data is expired, the receiver MUST discard it. Passing expired data to the application layer is a conformance failure at all levels.

**Processing PAYLOAD before verifying CHECKSUM.** Always verify the XXH3-64 checksum first. Passing unverified payloads to the application layer is both a conformance failure and a security concern.

**Sending HANDSHAKE with an empty or missing namespace.** The `namespace` field is required and MUST be a non-empty URI string. Peers receiving a HANDSHAKE with a missing namespace MUST respond with ERROR.

---

## Declaring Conformance

When your implementation reaches a conformance level, generate a report with the conformance runner and include it in your repository as `conformance-report.json`. Open an issue or MR in `axon-protocol/spec` to have your implementation listed on the wiki home page.

Implementation listings include: language, repository link, conformance level, and version of the spec tested against.