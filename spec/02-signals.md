# Signal Reference

AXON defines 15 signal types across five categories. Payload schemas are shown as JSON regardless of the codec in use; the actual wire encoding is the codec negotiated during HANDSHAKE.

---

## Categories

| Category | Signals |
|----------|---------|
| discovery | PROBE, PROBE_ACK |
| session | HANDSHAKE, HANDSHAKE_ACK, RELEASE, RELEASE_ACK |
| data | PUSH, PULL, CAST, SYNC |
| advanced | FUSE, FUSE_ACK |
| control | NUDGE, REVOKE, ERROR |

---

## Discovery

### 0x01 — PROBE

Sent by a node that wants to find a capable peer before committing to a session. Carries a structured capability descriptor. Relay nodes SHOULD forward PROBE signals to all reachable peers on the relevant network segment; non-matching nodes MUST NOT respond.

**Payload schema:**

```json
{ "provides": ["capability-id"], "consumes": ["capability-id"], "latency_class": "realtime | interactive | batch", "codecs": ["msgpack", "json", "cbor", "protobuf", "flatbuffers", "binary"], "compression": ["lz4", "zstd", "brotli", "none"], "version": "1.0.0" }
```

`provides` and `consumes` are arrays of opaque capability identifier strings. Their format is application-defined. A node MAY omit `provides` or `consumes` if either is empty.

**Expected response:** PROBE_ACK from any peer that satisfies the requirements, or silence.

**Valid states:** DORMANT, ACTIVE

---

### 0x02 — PROBE_ACK

Sent in response to a PROBE by any node that can satisfy the capabilities listed in `consumes`. A node that does not match MUST NOT send PROBE_ACK.

**Payload schema:**

```json
{ "provides": ["capability-id"], "codecs": ["msgpack", "json"], "compression": ["lz4", "none"], "version": "1.0.0" }
```

**Expected response:** HANDSHAKE from the original PROBE sender, or nothing if the sender selects a different peer.

**Valid states:** DORMANT, ACTIVE

---

## Session

### 0x03 — HANDSHAKE

Initiates a new session. Proposes a Context Bundle and preferred codec. The sender becomes the session initiator; the other party becomes the responder.

**Payload schema:**

```json
{ "namespace": "org.example.iot", "schema_url": "https://schema.example.org/v2/sensors", "auth_hash": "sha256:<hex>", "codec": "msgpack", "compression": "lz4", "metadata": {} }
```

`schema_url` and `metadata` are optional. `auth_hash` is the SHA-256 hash of the bearer credential — the credential itself MUST NOT appear in any AXON packet.

**Expected response:** HANDSHAKE_ACK (acceptance) or ERROR code `0x0001` (version mismatch) / `0x0006` (signal not valid in current state).

**Valid states:** DORMANT (responder), DISCOVERING (initiator after receiving PROBE_ACK)

---

### 0x04 — HANDSHAKE_ACK

Accepts the session and confirms negotiated parameters. If the responder cannot accept the proposed codec or compression, it SHOULD propose alternatives in `codec` and `compression` and the initiator MAY send a revised HANDSHAKE. After one counter-proposal, the responder MUST either accept or send ERROR.

**Payload schema:**

```json
{ "ctx_ref": 66, "codec": "msgpack", "compression": "lz4" }
```

`ctx_ref` is the handle allocated for this session's Context Bundle. It MUST be a non-zero uint32 unique within the responder's active sessions.

**Expected response:** None. The session enters ACTIVE state immediately on both sides.

**Valid states:** NEGOTIATING

---

### 0x0D — RELEASE

Initiates graceful session termination. The sender MUST NOT send any further signals after RELEASE except RELEASE_ACK (if receiving a RELEASE from the peer) or ERROR.

**Payload schema:**

```json
{ "reason_code": "0x00", "message": "optional human-readable reason" }
```

Standard reason codes:

| Code | Meaning |
|------|---------|
| 0x00 | Normal termination |
| 0x01 | Idle timeout |
| 0x02 | Resource exhaustion |
| 0xFF | Error-triggered release (accompanies ERROR signal) |

**Expected response:** RELEASE_ACK.

**Valid states:** ACTIVE, SYNCING, FUSING

---

### 0x0E — RELEASE_ACK

Confirms graceful termination. After sending or receiving RELEASE_ACK, the SESSION_ID and CTX_REF are freed. The underlying transport connection MAY be kept alive for a new session.

**Payload:** Empty (zero-length).

**Expected response:** None.

**Valid states:** RELEASING

---

## Data

### 0x05 — PUSH

Transmits data to the peer. The PAYLOAD is encoded in the negotiated codec. If the `REQUIRES_ACK` flag is set, the sender MUST wait for acknowledgment via NUDGE or a piggybacked sequence field before considering the packet delivered.

The `HAS_STALE_AT` flag MAY be set to indicate semantic expiry. See [Semantic Expiry](https://github.com/axon-prot/spec/blob/master/spec/04-semantic-expiry.md).

**Payload:** Application-defined data. No envelope required.

**Expected response:** NUDGE (if REQUIRES_ACK), or nothing (fire-and-forget).

**Valid states:** ACTIVE, FUSING

---

### 0x06 — PULL

Requests data from the peer. The responder delivers results as one or more PUSH signals referencing the PULL's SEQUENCE number for correlation.

**Payload schema:**

```json
{ "query": "topic.name or expression string", "seq_ref": 42, "limit": 100 }
```

`seq_ref` requests data by the SEQUENCE number of a prior PUSH. `query` requests by topic or expression. At least one of the two MUST be present. `limit` is optional and caps the number of PUSH responses.

**Expected response:** One or more PUSH signals from the peer.

**Valid states:** ACTIVE, FUSING

---

### 0x07 — CAST

Broadcasts data to all subscribers of a named topic. CAST is addressed to a topic string, not to a peer. Relay nodes that implement topic routing MUST fan the signal out to all sessions subscribed to that topic. Relay nodes that do not implement topic routing MUST forward the signal unchanged.

**Payload schema:**

```json
{ "topic": "alerts.temperature.critical", "data": {} }
```

The `data` field contains the application payload. STALE_AT MAY be set for ephemeral broadcasts that should be discarded if not delivered promptly.

**Expected response:** None (best-effort delivery; no ACK mechanism for CAST).

**Valid states:** ACTIVE, FUSING

---

### 0x08 — SYNC

Initiates state reconciliation between the two peers. The sender transmits the XXH3-64 Merkle root of its current state namespace. The receiver compares it with its own root. If they differ, the receiver sends its own SYNC in response; both then identify the diverged subtrees and exchange the delta via PUSH.

**Payload schema:**

```json
{ "digest": "a73f22b19e4d00c8", "namespace": "org.example.iot", "depth": 3 }
```

`digest` is the XXH3-64 Merkle root as a hex string. `depth` indicates how many subtree levels the sender is prepared to exchange. `namespace` MUST match the session's Context Bundle namespace.

During a SYNC exchange, both peers transition to the SYNCING state. PUSH and PULL signals received during this period MUST be queued and processed after reconciliation is complete.

**Expected response:** SYNC from the peer (if digests differ), followed by PUSH exchanges for the delta, or silence (if digests match).

**Valid states:** ACTIVE

---

## Advanced

### 0x09 — FUSE

Requests to merge the current session with a second live session, identified by the target's SESSION_ID. If accepted, data from both sessions will flow through a single unified context stream. Both original SESSION_IDs remain valid as aliases indefinitely.

**Payload schema:**

```json
{ "target_session_id": "a3f2b144-...-9d1c" }
```

The target session MUST already be in the ACTIVE state. A FUSE into a session in any other state MUST be rejected with ERROR code `0x0007`.

**Expected response:** FUSE_ACK.

**Valid states:** ACTIVE

---

### 0x0A — FUSE_ACK

Confirms session fusion. Returns the new merged Context Bundle handle and the canonical SESSION_IDs for both aliases.

**Payload schema:**

```json
{ "ctx_ref": 99, "primary_session_id": "a3f2b144-...-9d1c", "alias_session_id": "f7c19ab2-...-4e88" }
```

After FUSE_ACK, both sessions enter ACTIVE state under the merged context. Either SESSION_ID MAY be used in subsequent packets.

**Expected response:** None. Both sessions transition to ACTIVE immediately.

**Valid states:** FUSING

---

## Control

### 0x0B — NUDGE

A lightweight keepalive. Optionally carries up to 64 bytes of piggybacked application data, avoiding a separate round-trip for small updates. When REQUIRES_ACK is set on a prior PUSH, NUDGE serves as the explicit acknowledgment; the `seq_ack` field identifies the highest confirmed sequence.

**Payload schema (optional):**

```json
{ "seq_ack": 42, "data": "<up to 64 bytes, base64 in JSON>" }
```

Both `seq_ack` and `data` are optional. A NUDGE with an empty payload is a pure keepalive.

**Expected response:** None.

**Valid states:** ACTIVE, SYNCING, FUSING, RELEASING

---

### 0x0C — REVOKE

Invalidates a previously sent packet by its SEQUENCE number. Recipients that have not yet processed the referenced packet MUST discard it. Recipients that have already processed it MUST ignore the REVOKE — it cannot recall delivered data.

**Payload schema:**

```json
{ "seq_ref": 42, "reason": "optional string" }
```

`seq_ref` MUST reference a SEQUENCE number from the sender's own prior packets within the current session. A REVOKE referencing an unknown or already-processed sequence MUST be silently ignored.

**Expected response:** None.

**Valid states:** ACTIVE, FUSING

---

### 0xFF — ERROR

Signals an unrecoverable condition. Triggers immediate transition to the ERROR state on both peers. An implicit RELEASE with reason `0xFF` is assumed; no RELEASE or RELEASE_ACK exchange is required.

**Payload schema:**

```json
{ "code": "0x0005", "message": "Checksum failure on packet seq 0x42" }
```

**Standard error codes:**

| Code | Meaning |
|------|---------|
| 0x0001 | Version mismatch |
| 0x0002 | Unknown signal type |
| 0x0003 | Oversized payload |
| 0x0004 | Invalid CTX_REF |
| 0x0005 | Malformed packet (checksum failure or truncation) |
| 0x0006 | Signal not valid in current session state |
| 0x0007 | FUSE target session not found or not ACTIVE |

Implementations MAY define additional error codes in the range `0x1000–0xFFFF`. Codes `0x0008–0x0FFF` are reserved.

**Expected response:** None. The session is terminated.

**Valid states:** Any