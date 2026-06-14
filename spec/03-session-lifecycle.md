# Session Lifecycle

An AXON session passes through a defined set of states from first contact to termination. Implementations MUST enforce state constraints: a signal received in an invalid state MUST result in an ERROR (code `0x0006`), not silent acceptance.

---

## States

| State | Description |
|-------|-------------|
| DORMANT | No session. The node is listening for inbound PROBE or HANDSHAKE signals. |
| DISCOVERING | PROBE sent. Awaiting PROBE_ACK. The node has not yet committed to a peer. |
| NEGOTIATING | HANDSHAKE sent or received. Codec and Context Bundle being agreed. |
| ACTIVE | Session fully established. All data and control signals are permitted. |
| SYNCING | SYNC in progress. PUSH and PULL are queued; other signals remain valid. |
| FUSING | FUSE sent and awaiting FUSE_ACK. Both original sessions remain individually usable. |
| RELEASING | RELEASE sent. No new outbound signals permitted except RELEASE_ACK and ERROR. |
| ERROR | Unrecoverable failure. The session is closed. No further signals are valid. |

---

## State Transitions

```
                       ┌──────────────────────────────────────────────┐
                       │                                              │
             send PROBE│                                  ERROR       │
         ┌─────────────▼──────────────────────────────────────────────▼────────┐
         │            DORMANT ◄──────────── RELEASING ◄──────── ACTIVE         │
         │                │                    ▲          ▲       │  │  │      │
         │  recv PROBE_ACK│                    │RELEASE   │       │  │  │      │
         │  + send        │                    │          │       │  │  │      │
         │  HANDSHAKE     │   recv/send        │          │       │  │  │      │
         │                │   HANDSHAKE_ACK    │  FUSE_ACK│       │  │  │      │
         │                ▼                    │          │   SYNC│  │  │FUSE  │
         │         DISCOVERING          NEGOTIATING       │       ▼  │  ▼      │
         │                                                │     SYNCING FUSING │
         │                                                │                    │
         └──────────────────────────────────────── ERROR ──────────────────────┘
```

### Transition table

| From | Signal / Event | To |
|------|----------------|----|
| DORMANT | send PROBE | DISCOVERING |
| DORMANT | recv HANDSHAKE | NEGOTIATING |
| DISCOVERING | recv PROBE_ACK | NEGOTIATING |
| DISCOVERING | timeout (max retries) | DORMANT |
| DISCOVERING | recv ERROR | ERROR |
| NEGOTIATING | send HANDSHAKE | NEGOTIATING |
| NEGOTIATING | send HANDSHAKE_ACK | ACTIVE |
| NEGOTIATING | recv HANDSHAKE_ACK | ACTIVE |
| NEGOTIATING | recv ERROR | ERROR |
| ACTIVE | send / recv SYNC | SYNCING |
| ACTIVE | send FUSE | FUSING |
| ACTIVE | send RELEASE | RELEASING |
| ACTIVE | recv ERROR | ERROR |
| SYNCING | reconciliation complete | ACTIVE |
| SYNCING | recv ERROR | ERROR |
| SYNCING | send RELEASE | RELEASING |
| FUSING | recv FUSE_ACK | ACTIVE |
| FUSING | recv ERROR | ERROR |
| RELEASING | recv RELEASE_ACK | DORMANT |
| RELEASING | timeout | DORMANT |
| RELEASING | recv ERROR | ERROR |
| ERROR | (implementation reset) | DORMANT |

---

## Signals Valid Per State

A signal is listed as valid if the node MAY send it in that state. Receiving an invalid signal MUST produce ERROR `0x0006`.

| Signal | DORMANT | DISCOVERING | NEGOTIATING | ACTIVE | SYNCING | FUSING | RELEASING |
|--------|---------|-------------|-------------|--------|---------|--------|-----------|
| PROBE | ✓ |  |  | ✓ |  |  |  |
| PROBE_ACK | ✓ |  |  | ✓ |  |  |  |
| HANDSHAKE | ✓ | ✓ | ✓ |  |  |  |  |
| HANDSHAKE_ACK |  |  | ✓ |  |  |  |  |
| PUSH |  |  |  | ✓ | queued | ✓ |  |
| PULL |  |  |  | ✓ | queued | ✓ |  |
| CAST |  |  |  | ✓ |  | ✓ |  |
| SYNC |  |  |  | ✓ |  |  |  |
| FUSE |  |  |  | ✓ |  |  |  |
| FUSE_ACK |  |  |  |  |  | ✓ |  |
| NUDGE |  |  |  | ✓ | ✓ | ✓ | ✓ |
| REVOKE |  |  |  | ✓ |  | ✓ |  |
| RELEASE |  |  |  | ✓ | ✓ | ✓ |  |
| RELEASE_ACK |  |  |  |  |  |  | ✓ |
| ERROR | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Example Flow

A complete session from capability discovery to termination:

```
CLIENT                                         SERVER
  │                                               │
  ├── PROBE ─────────────────────────────────────►│
  │   consumes: ['ingest-metrics']                │
  │◄── PROBE_ACK ─────────────────────────────────┤
  │    provides: ['ingest-metrics']               │
  │                                               │
  ├── HANDSHAKE ─────────────────────────────────►│
  │   ns: 'org.acme.iot', codec: 'msgpack'        │
  │◄── HANDSHAKE_ACK ─────────────────────────────┤
  │    ctx_ref: 0x0042                            │
  │                                               │
  │           ═══ SESSION ACTIVE ═══              │
  │                                               │
  ├── PUSH ──────────────────────────────────────►│
  │   {sensor:'T1', temp:22.4}  STALE_AT:+5000ms  │
  ├── PUSH ──────────────────────────────────────►│
  │   {sensor:'T1', temp:22.7}  REQUIRES_ACK      │
  │◄── NUDGE ─────────────────────────────────────┤
  │    seq_ack: 0x0002                            │
  │                                               │
  ├── SYNC ──────────────────────────────────────►│
  │   digest: 0xDEADBEEF...                       │
  │◄── SYNC ──────────────────────────────────────┤
  │    digest: 0xCAFEBABE... (1 record delta)     │
  │◄── PUSH ──────────────────────────────────────┤
  │    delta payload                              │
  │                                               │
  ├── REVOKE ────────────────────────────────────►│
  │   seq_ref: 0x0001                             │
  │                                               │
  ├── RELEASE ───────────────────────────────────►│
  │   reason: 0x00                                │
  │◄── RELEASE_ACK ───────────────────────────────┤
  │                                               │
```

---

## PROBE-less Sessions

Capability discovery via PROBE is optional. A node that already knows its peer's address and capabilities MAY send HANDSHAKE directly from the DORMANT state, transitioning straight to NEGOTIATING. This is appropriate for point-to-point deployments with static configuration.

---

## Simultaneous RELEASE

If both peers send RELEASE in the same round-trip (a simultaneous close), both MUST treat the crossing RELEASEs as accepted. Each peer sends RELEASE_ACK and transitions to DORMANT. No ERROR should be raised.

---

## SYNCING State Detail

During SYNC, PUSH and PULL signals from the application layer are queued by the receiver and processed in order once the SYNC exchange completes. The queue depth is implementation-defined; implementations MUST document their queue limit and SHOULD emit a NUDGE to the sender when the queue is near capacity.

A RELEASE sent during SYNCING cancels the sync and transitions directly to RELEASING. Queued PUSH / PULL signals are discarded.