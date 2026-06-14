# Semantic Expiry

AXON allows data to declare its own meaningfulness window through the `STALE_AT` header field. When a packet arrives after its expiry condition is met, the receiver MUST discard it without processing its payload. This eliminates an entire class of application-level staleness bugs that arise when receivers have no way of knowing whether data is still valid.

---

## The STALE_AT Field

`STALE_AT` is a conditional 64-bit big-endian unsigned integer. It is present in the packet only when the `HAS_STALE_AT` flag (bit 2 of FLAGS) is set; when absent, the field is omitted entirely from the wire and the data has no automatic expiry.

The top two bits of `STALE_AT` select the expiry type. The remaining 62 bits carry the value:

```
Bit 63  Bit 62   Meaning of lower 62 bits
------  ------   --------------------------
  0       0      Absolute timestamp — Unix epoch in milliseconds
  0       1      Relative offset — milliseconds from send time
  1       0      Event hash — XXH3-64 of an event topic string
  1       1      Manual / never — no automatic expiry
```

---

## Expiry Types

### 00 — Absolute Timestamp

The lower 62 bits are a Unix timestamp in milliseconds. The packet is stale if `now_ms >= stale_at_value` at the time of processing.

```
STALE_AT = 0x000001946B9AD400  →  type=00, expires at 2025-06-14T12:00:00.000Z
```

Use this when the data has a fixed wall-clock expiry that both sender and receiver agree on. Requires reasonably synchronised clocks (NTP or equivalent).

### 01 — Relative Offset

The lower 62 bits are a duration in milliseconds. The receiver computes the absolute expiry as:

```
absolute_expiry_ms = received_at_ms + stale_at_value
```

```
STALE_AT = 0x4000000000001388  →  type=01, expires 5 000 ms after receipt
```

Use this when you want a TTL-style window without requiring clock synchronisation. Appropriate for sensor readings, cache entries, and ephemeral status updates.

### 10 — Event Hash

The lower 62 bits are the XXH3-64 hash of an event topic string. The packet is stale from the moment any peer on the mesh publishes a CAST to that topic.

```
STALE_AT = 0x8000A73F22B19E4D  →  type=10, stale when topic 0xA73F22B19E4D is CASTed
```

To compute the hash:

```
topic_hash = xxh3_64("alerts.temperature.reset") & 0x3FFFFFFFFFFFFFFF
stale_at   = 0x8000000000000000 | topic_hash
```

Relay nodes that implement event-based expiry MUST maintain a rolling index of recently CASTed topic hashes and discard buffered packets whose event-hash STALE_AT matches. The retention window for this index is implementation-defined but SHOULD be at least 60 seconds.

Receivers that do not implement event-based expiry MUST treat `type=10` packets as having no automatic expiry (equivalent to `type=11`). They SHOULD note this in their conformance declaration.

### 11 — Manual / Never

The packet has no automatic expiry. It persists in the session until explicitly invalidated via REVOKE or the session is RELEASEd.

```
STALE_AT = 0xC000000000000000  →  type=11, no automatic expiry
```

Setting `HAS_STALE_AT` with `type=11` is equivalent to omitting the field entirely, but is useful when a sender wants to make an explicit statement that the data is intended to be long-lived.

---

## Receiver Behaviour

When a packet with `HAS_STALE_AT` set is received, the receiver MUST evaluate expiry before passing the payload to the application layer:

1. Extract the type from bits 63–62.
2. For `type=00`: if `now_ms >= lower_62_bits`, discard silently.
3. For `type=01`: compute `expiry = received_at_ms + lower_62_bits`. If `now_ms >= expiry`, discard silently.
4. For `type=10`: if the topic hash matches a recently CASTed topic, discard silently. Otherwise, pass the payload to the application layer; the application SHOULD register for the event and discard cached results if it fires later.
5. For `type=11`: never discard on this basis alone.

Discarding a stale packet MUST be silent — no ERROR, no NUDGE, no notification to the sender. The sender is responsible for ensuring STALE_AT values are appropriate for the expected transit time.

---

## Interaction with REVOKE

REVOKE and STALE_AT are complementary, not redundant:

| Mechanism | Initiated by | Works on | Retroactive? |
|-----------|--------------|----------|--------------|
| STALE_AT | Sender (at send time) | Unprocessed packets | No — declared upfront |
| REVOKE | Sender (at any time) | Unprocessed packets | Yes — can target past sends |

Use STALE_AT when the expiry window is known at send time. Use REVOKE when expiry is triggered by something that happens after the fact — a user cancels an action, a reading is found to be erroneous, a newer value supersedes an older one.

REVOKE does not remove a packet from a receiver that has already processed it. Neither does STALE_AT. Both mechanisms are forward-cancellation only.

---

## CAST and Ephemeral Broadcasts

CAST supports STALE_AT for ephemeral fan-out events. A CAST with a relative-offset STALE_AT is appropriate for alerts that are only actionable within a short window:

```
{
  "topic": "alerts.temperature.critical",
  "data": { "sensor": "T1", "temp": 95.2 }
}
```

With `HAS_STALE_AT` set and `type=01, value=10000` (10 seconds), relay nodes and receivers that have not yet processed the CAST will discard it after 10 seconds. This prevents stale alerts from being delivered to subscribers that come online after the event has already been handled.

---

## Clock Considerations

For `type=00` (absolute timestamp), the sender and receiver MUST have clocks within a reasonable tolerance of each other. The protocol does not define a clock synchronisation mechanism; implementations that use absolute timestamps SHOULD document their clock requirements and SHOULD tolerate at least ±1 second of clock skew before raising an alarm.

For maximum portability, prefer `type=01` (relative offset) in deployments where clock synchronisation cannot be guaranteed.