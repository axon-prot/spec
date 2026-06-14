# Packet Structure

All AXON packets share a single fixed binary header format. Fields are big-endian. The `STALE_AT` field is conditional and present only when the `HAS_STALE_AT` flag (bit 2) is set.

---

## Header Layout

```
Offset  Field         Size    Type         Notes
------  ------------  ------  -----------  ----------------------------------------------
0       MAGIC         4 B     bytes        0x41 0x58 0x4F 0x4E ("AXON")
4       VERSION       2 B     u8 · u8      Major version, minor version
6       FLAGS         2 B     u16 (BE)     Feature flag bitfield
8       SESSION_ID    16 B    UUID v4      Assigned at HANDSHAKE
24      SIGNAL        1 B     u8           Signal type code
25      SEQUENCE      7 B     u56 (BE)     Per-session monotonic counter
32      CTX_REF       4 B     u32 (BE)     Context Bundle handle

36      STALE_AT      8 B     u64 (BE)     Conditional — see Semantic Expiry
36|44   PAYLOAD_LEN   4 B     u32 (BE)     Byte count of PAYLOAD
40|48   PAYLOAD       N B     —            Codec-encoded data
40+N    CHECKSUM      8 B     u64 (BE)     XXH3-64 of all preceding bytes
```

Offsets in brackets `[n]` indicate conditional positions depending on whether `STALE_AT` is present.

---

## Fields

### MAGIC

Fixed four bytes: `0x41 0x58 0x4F 0x4E` (ASCII `AXON`).

Receivers MUST check this field first. A packet whose first four bytes do not match MUST be silently dropped. An ERROR response MUST NOT be sent for non-AXON traffic, as the sender may not be an AXON implementation at all.

### VERSION

Two bytes: `Major` then `Minor`.

* **Major version** identifies breaking changes to the wire format or signal semantics. Receivers encountering a mismatched major version MUST respond with an ERROR signal (code `0x0001`) and proceed to RELEASE.
* **Minor version** identifies additive changes. Receivers SHOULD tolerate higher minor versions from peers gracefully, ignoring fields or signals they do not recognise.

Current version: `0x01 0x00` (v1.0).

### FLAGS

A 16-bit big-endian bitfield. See [FLAGS Breakdown](https://github.com/axon-prot/spec/blob/master/spec/01-packet-structure.md#flags-breakdown) below.

### SESSION_ID

A 128-bit UUID v4 assigned by the initiating node during the HANDSHAKE exchange. All packets belonging to the same session carry the same SESSION_ID.

Stateless intermediary relay nodes MUST use SESSION_ID as the sole routing key. They MUST NOT inspect any other field to make routing decisions.

### SIGNAL

A single byte identifying the signal type. See [Signal Reference](https://github.com/axon-prot/spec/blob/master/spec/02-signals.md) for all valid codes.

Receivers encountering an unknown signal code MUST respond with an ERROR signal (code `0x0002`). Unknown signals MUST NOT be silently dropped.

### SEQUENCE

A 56-bit big-endian unsigned integer. Each node maintains a per-session sequence counter starting at `0x00000000000001` and incrementing by one for every outbound packet. The counter MUST NOT reset during a session.

The 56-bit address space supports approximately 72 quadrillion signals per session before overflow, which is considered effectively unbounded for operational purposes.

SEQUENCE is used for:

* Packet ordering and deduplication
* REVOKE targeting (`seq_ref` in the payload)
* Correlation of PULL requests with their PUSH responses

### CTX_REF

A 32-bit unsigned integer referencing the shared Context Bundle established during HANDSHAKE. This handle allows all subsequent packets to omit the full namespace, schema URL, and auth data that were exchanged once at session open.

A CTX_REF of `0x00000000` is reserved and MUST NOT be issued by a server.

If a receiver receives a packet with an unknown CTX_REF, it MUST respond with an ERROR (code `0x0004`) and transition to the ERROR state.

### STALE_AT (conditional)

Present only when the `HAS_STALE_AT` flag (bit 2) is set. A 64-bit big-endian unsigned integer encoding a semantic expiry value. See [Semantic Expiry](https://github.com/axon-prot/spec/blob/master/spec/04-semantic-expiry.md) for full encoding details.

### PAYLOAD_LEN

A 32-bit unsigned integer giving the byte length of the PAYLOAD field. A value of `0x00000000` is valid and indicates an empty payload.

Implementations SHOULD enforce a maximum payload size. The recommended ceiling is 64 MiB (`0x04000000`). Payloads exceeding the implementation's maximum MUST result in an ERROR (code `0x0003`).

### PAYLOAD

Variable-length data encoded in the codec negotiated during HANDSHAKE. When the `COMPRESSED` flag is set, the data is compressed before being written to this field; receivers MUST decompress before decoding.

A zero-length PAYLOAD is valid for signals that carry no data (e.g. NUDGE, RELEASE, RELEASE_ACK).

### CHECKSUM

An 8-byte XXH3-64 hash computed over all bytes preceding this field (i.e. MAGIC through the end of PAYLOAD, inclusive).

Receivers MUST verify the checksum before processing any packet. A checksum failure MUST result in an ERROR (code `0x0005`). XXH3-64 was chosen for its exceptional throughput (\>30 GB/s on modern hardware) rather than cryptographic properties. For cryptographic integrity, use TLS at the transport layer or the `ENCRYPTED` flag.

---

## FLAGS Breakdown

```
Bit     Name                Description
------  ------------------  -------------------------------------------------------------
0       COMPRESSED          Payload is compressed. Algorithm negotiated at HANDSHAKE.

1       ENCRYPTED           Payload is end-to-end encrypted. Keys established
                            out-of-band or via a HANDSHAKE extension field.

2       HAS_STALE_AT        The STALE_AT field is present in this packet.

3       FRAGMENTED          This packet is one fragment of a larger payload.
                            Fragments are reassembled by matching
                            SESSION_ID + SEQUENCE range.

4       LAST_FRAGMENT       This is the terminal fragment; begin reassembly.

5       PRIORITY_HIGH       Queue-jump over NORMAL traffic at relay nodes.

6       PRIORITY_CRITICAL   Bypass queuing entirely. Reserved for ERROR signals
                            and safety-critical control messages.

7       REQUIRES_ACK        Sender requires explicit acknowledgment via NUDGE
                            or piggyback on the peer's next outbound
                            SEQUENCE field.

8       CHILD_SESSION       Packet belongs to a child session spawned from the
                            parent identified by SESSION_ID.

9       FUSED               This SESSION_ID is an alias over a merged session
                            context, created via a FUSE / FUSE_ACK exchange.

10-15   RESERVED            MUST be set to 0 by senders.
                            Receivers MUST ignore unknown flag bits and MUST
                            NOT raise an error for them.
```

When both `PRIORITY_HIGH` (bit 5) and `PRIORITY_CRITICAL` (bit 6) are set, `PRIORITY_CRITICAL` takes precedence.

---

## Checksum Computation

```
checksum = XXH3_64(packet[0 .. CHECKSUM_offset - 1])
```

The checksum covers every byte from the start of MAGIC up to and including the last byte of PAYLOAD. It does not cover itself.

Implementations MUST compute the checksum before sending and verify it before processing. There is no mechanism to waive the checksum.

---

## Minimum Packet Sizes

| Condition | Size |
|-----------|------|
| No payload, no STALE_AT | 48 bytes |
| No payload, with STALE_AT | 56 bytes |
| N-byte payload, no STALE_AT | 48 + N |
| N-byte payload, with STALE_AT | 56 + N |

