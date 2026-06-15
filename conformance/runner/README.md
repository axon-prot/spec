# AXON Conformance Suite

Transport-agnostic conformance tests for the [AXON protocol specification](https://github.com/axon-prot/spec/tree/master/spec).
The runner connects to any AXON implementation over TCP or WebSocket and drives it
through a sequence of packet exchanges, verifying the responses against normative
requirements from the spec.

---

## Quick start

```bash
git clone https://github.com/axon-prot/spec.git
cd spec/conformance/runner
npm install

# Test a Level 1 implementation over TCP
npm test -- --endpoint tcp://localhost:4200

# Test a Level 2 implementation over WebSocket
npm test -- --endpoint ws://localhost:4200 --level 2

# Test Level 3, write a JSON report, and show step-level detail
npm test -- --endpoint tcp://localhost:4200 --level 3 \
            --report conformance-report.json --verbose
```

Exit code is `0` when every test in scope passes, `1` otherwise.

---

## CLI reference

| Flag | Description | Default |
|------|-------------|---------|
| `--endpoint <url>` | `tcp://`, `ws://`, or `wss://` URL of the implementation **(required)** | — |
| `--level <n>` | Conformance level to test: `1`, `2`, or `3` | `1` |
| `--timeout <ms>` | Per-test packet-wait timeout | `5000` |
| `--filter <id>` | Run only tests whose ID contains this string | — |
| `--report <path>` | Write a JSON conformance report to this file | — |
| `--verbose` / `-v` | Show step-level pass/fail detail | off |
| `--no-color` | Disable ANSI colour output | off |
| `--help` / `-h` | Print usage and exit | — |

---

## Conformance levels

Levels are strict supersets. A Level 2 run also executes all Level 1 cases.

### Level 1 — Core

Sufficient for simple point-to-point data exchange with a known peer.

Required: `HANDSHAKE`, `HANDSHAKE_ACK`, `PUSH`, `NUDGE`, `RELEASE`, `RELEASE_ACK`, `ERROR`

Covered by the suite:

| ID | What is tested |
|----|----------------|
| L1-001 | Invalid MAGIC → silent drop (no ERROR) |
| L1-002 | Major version mismatch → `ERROR 0x0001` |
| L1-003 | Higher minor version → tolerated (no ERROR) |
| L1-004 | Bad XXH3-64 checksum → `ERROR 0x0005` |
| L1-005 | Unknown signal code → `ERROR 0x0002` |
| L1-006 | HANDSHAKE → HANDSHAKE_ACK happy path |
| L1-007 | `ctx_ref` in HANDSHAKE_ACK must be non-zero |
| L1-008 | Unknown `ctx_ref` in subsequent packet → `ERROR 0x0004` |
| L1-009 | Signal in wrong session state → `ERROR 0x0006` |
| L1-010 | RELEASE → RELEASE_ACK graceful termination |
| L1-011 | PUSH (fire-and-forget) → silence |
| L1-012 | PUSH + `REQUIRES_ACK` → NUDGE with matching `seq_ack` |
| L1-013 | NUDGE keepalive → silence |
| L1-014 | Absolute STALE_AT (expired) → PUSH discarded, no NUDGE |
| L1-015 | Absolute STALE_AT (future) → PUSH processed, NUDGE sent |
| L1-016 | Relative STALE_AT (0 ms) → PUSH discarded, no NUDGE |
| L1-017 | Relative STALE_AT (1 hr) → PUSH processed, NUDGE sent |
| L1-018 | Codec counter-proposal negotiation |
| L1-019 | REVOKE accepted without ERROR |
| L1-020 | Simultaneous RELEASE handled without ERROR |

### Level 2 — Standard

Adds capability discovery, pub/sub, and data revocation.

Required additions: `PROBE`, `PROBE_ACK`, `PULL`, `CAST`, `REVOKE`

| ID | What is tested |
|----|----------------|
| L2-001 | PROBE → PROBE_ACK |
| L2-002 | PROBE_ACK includes required `codecs` and `version` fields |
| L2-003 | PULL → PUSH response(s) |
| L2-004 | REVOKE discards unprocessed PUSH (verified by absent NUDGE) |

### Level 3 — Full

Adds state synchronisation and session fusion.

Required additions: `SYNC`, `FUSE`, `FUSE_ACK`, event-hash STALE_AT

| ID | What is tested |
|----|----------------|
| L3-001 | SYNC with non-matching digest → counter-SYNC |
| L3-002 | PUSH queued during SYNCING state, no `ERROR 0x0006` |
| L3-003 | FUSE → FUSE_ACK with new non-zero `ctx_ref` |
| L3-004 | FUSE namespace mismatch → `ERROR 0x0007` |
| L3-005 | Event-hash STALE_AT discards PUSH when matching CAST arrives |

---

## Test case format

Each case is a JSON file in `cases/` with the following shape:

```jsonc
{
  "id": "L1-012",
  "level": 1,
  "description": "Human-readable assertion",
  "normative_ref": "spec/01-packet-structure.md § FLAGS",
  "notes": "Optional prose for timing caveats or design rationale.",
  "steps": [ /* step objects */ ]
}
```

### Step actions

#### `establish_session`

Runs a full HANDSHAKE → HANDSHAKE_ACK exchange, handles a single codec
counter-proposal, and captures `ctx_ref` for use in subsequent steps.

```jsonc
{
  "action": "establish_session",
  "namespace":   "org.axon.conformance",  // default
  "codec":       "json",                  // default
  "compression": "none",                  // default
  "connection":  "conn_b",                // which connection to use (default: "default")
  "as":          "sess_a",               // variable prefix for captured values
  "timeout_ms":  5000
}
```

After this step `$<as>_session_id_str` and `$<as>_ctx_ref` are available as
template variables.

#### `open_connection`

Opens an additional transport connection. Required for FUSE tests.

```jsonc
{ "action": "open_connection", "as": "conn_b" }
```

#### `send`

Builds and transmits one AXON packet.

```jsonc
{
  "action":    "send",
  "signal":    "PUSH",               // signal name or numeric code
  "payload":   { "key": "value" },   // object → JSON-stringified; null → empty
  "flags":     ["REQUIRES_ACK"],     // array of flag names
  "connection": "conn_b",            // default: "default"

  // Packet overrides (prefix _ distinguishes them from payload fields):
  "_ctx_ref":          42,                      // override CTX_REF
  "_session_id":       "random",                // new UUID, or 32-char hex
  "_version":          [1, 99],                 // override VERSION bytes
  "_magic":            "BAAD",                  // override MAGIC (ASCII)
  "_corrupt_checksum": true,                    // flip checksum bits
  "_stale_at": {
    "type": "absolute", "expired": true         // or false for far-future
  }
}
```

STALE_AT descriptor shapes:

| Shape | Wire encoding |
|-------|--------------|
| `{ "type": "absolute", "expired": true }` | type=00, value=0 (Unix epoch) |
| `{ "type": "absolute", "expired": false }` | type=00, value=100 years from now |
| `{ "type": "relative", "ms": 0 }` | type=01, value=0 ms (instant expiry) |
| `{ "type": "relative", "ms": 3600000 }` | type=01, value=3 600 000 ms |
| `{ "type": "event", "topic": "a.b.c" }` | type=10, XXH3-64(topic) & low 62 bits |
| `{ "type": "manual" }` | type=11, 0xC000000000000000 |
| `"0x4000000000000001"` | raw BigInt (hex string) |

#### `send_raw`

Sends arbitrary bytes, bypassing the packet builder entirely.
Used for invalid MAGIC or pre-computed malformed packets.

```jsonc
{ "action": "send_raw", "data": "424141440100..." }
```

#### `expect`

Waits for a packet and validates it. Fails on timeout or mismatch.

```jsonc
{
  "action":         "expect",
  "signal":         "ERROR",         // signal name or "*" to accept any
  "error_code":     "0x0005",        // checked only when signal=="ERROR"
  "assert_seq_ack": true,            // check NUDGE.seq_ack == last sent PUSH seq
  "timeout_ms":     3000,
  "connection":     "conn_b",
  "assert": {
    "payload_json.ctx_ref": { "nonzero": true },
    "signal":               { "not": 255 }
  },
  "capture": {
    "payload_json.ctx_ref": "fuse_ctx_ref"   // stores value in a template variable
  }
}
```

Assertion value shapes:

| Shape | Meaning |
|-------|---------|
| `42` | exact equality |
| `{ "not": 0 }` | must not equal |
| `{ "nonzero": true }` | must be truthy |
| `{ "gt": 0 }` | must be greater than |

Template variables (`$varname`) in `payload` fields are substituted at runtime
with values previously stored via `capture` or after `establish_session`.

#### `expect_silence`

Waits `timeout_ms` and fails if any packet arrives.

```jsonc
{ "action": "expect_silence", "timeout_ms": 500 }
```

#### `release_session`

Sends RELEASE and waits for RELEASE_ACK.

```jsonc
{ "action": "release_session", "reason_code": "0x00" }
```

---

## Adding test cases

1. Create a new JSON file in `cases/` following the naming convention
   `L<level>-<NNN>-<short-slug>.json`.
2. Set `"level"` to the minimum conformance level that requires the behaviour.
3. Include a `"normative_ref"` pointing to the relevant spec section.
4. Add at least one conformance test case to `conformance/cases/` alongside
   any spec change (see `CONTRIBUTING.md`).

Run the suite against your implementation to verify:

```bash
npm test -- --endpoint tcp://localhost:4200 --level 1 --verbose
```

---

## JSON report schema

When `--report` is given, the runner writes a machine-readable report:

```jsonc
{
  "meta": {
    "endpoint":     "tcp://localhost:4200",
    "level":        1,
    "spec_version": "1.0",
    "runner":       "axon-conformance-runner@1.0.0"
  },
  "summary": {
    "total":     20,
    "passed":    19,
    "failed":    1,
    "timestamp": "2026-06-15T10:00:00.000Z"
  },
  "cases": [
    {
      "id":          "L1-004",
      "level":       1,
      "description": "Bad XXH3-64 checksum → ERROR 0x0005",
      "passed":      false,
      "error":       "Expected ERROR, got NUDGE",
      "steps":       [
        { "action": "establish_session", "passed": true,  "error": null },
        { "action": "send",             "passed": true,  "error": null },
        { "action": "expect",           "passed": false, "error": "Expected ERROR, got NUDGE" }
      ]
    }
  ]
}
```
