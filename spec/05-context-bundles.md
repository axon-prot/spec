# Context Bundles

A Context Bundle is the shared semantic namespace that two AXON peers establish during HANDSHAKE. Rather than repeating authentication credentials, schema references, and codec preferences in every packet, these are negotiated once and then referenced by a compact 4-byte handle (`CTX_REF`) for the lifetime of the session.

---

## Purpose

Without a shared context, every data packet would need to carry enough metadata for the receiver to interpret it correctly — who sent it, what schema it follows, how it is encoded. Context Bundles solve this by front-loading that negotiation into the session-open exchange and referencing the result with a single integer for the rest of the session.

---

## Fields

Context Bundle fields are proposed in the HANDSHAKE payload and confirmed in HANDSHAKE_ACK:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `namespace` | URI string | Yes | Identifies the semantic domain. Scopes capability identifiers, schema references, and topic names within this session. |
| `schema_url` | URI string | No | URL of a schema document describing valid PUSH / PULL payloads. Informational — AXON does not validate payloads against the schema. |
| `auth_hash` | Hex string | No | SHA-256 hash of the bearer credential. The credential itself MUST NOT appear in any AXON packet. Verification is out-of-band. |
| `codec` | String | Yes | Negotiated encoding for all PAYLOAD fields in this session. See [Codec Values](#codec-values). |
| `compression` | String | Yes | Negotiated compression algorithm. `none` indicates no compression. See [Compression Values](#compression-values). |
| `metadata` | Object | No | Arbitrary key-value pairs for application-defined session context. Both parties MUST preserve and echo unknown metadata keys. |

### Codec Values

| Value | Encoding |
|-------|----------|
| `json` | UTF-8 JSON |
| `msgpack` | MessagePack |
| `cbor` | CBOR (RFC 8949) |
| `protobuf` | Protocol Buffers (schema delivered via `schema_url`) |
| `flatbuffers` | FlatBuffers (schema delivered via `schema_url`) |
| `binary` | Raw bytes — application-defined framing |

### Compression Values

| Value | Algorithm |
|-------|-----------|
| `none` | No compression |
| `lz4` | LZ4 frame format |
| `zstd` | Zstandard |
| `brotli` | Brotli |

---

## Negotiation

The HANDSHAKE sender proposes its preferred codec and compression. The HANDSHAKE_ACK responder confirms the accepted values:

```
CLIENT                                 SERVER
  │                                       │
  ├── HANDSHAKE ─────────────────────────►│
  │   { ns: 'org.acme.iot',               │
  │     codec: 'msgpack',                 │
  │     compression: 'lz4' }              │
  │◄── HANDSHAKE_ACK ─────────────────────┤
  │    { ctx_ref: 0x0042,                 │
  │      codec: 'msgpack',                │
  │      compression: 'lz4' }             │
```

If the responder cannot accept the proposed codec, it SHOULD include its own preferred values in HANDSHAKE_ACK:

```
{ "ctx_ref": 0, "codec": "json", "compression": "none" }
```

A `ctx_ref` of `0` in HANDSHAKE_ACK signals a counter-proposal. The initiator MAY send a revised HANDSHAKE. After one counter-proposal, the responder MUST either accept the initiator's second proposal or send ERROR `0x0001`. This prevents infinite negotiation loops.

---

## The ctx_ref Handle

The `ctx_ref` is a 32-bit unsigned integer allocated by the HANDSHAKE_ACK sender. It is:

* Unique within the responder's current active sessions
* Non-zero (`0x00000000` is reserved and MUST NOT be issued)
* Opaque to the initiator — the initiator MUST treat it as an arbitrary identifier
* Valid for the lifetime of the session and invalidated on RELEASE_ACK

Every packet after HANDSHAKE_ACK carries the `CTX_REF` field. Receivers encountering an unknown ctx_ref MUST respond with ERROR `0x0004`.

---

## Child Sessions

A node MAY spawn child sessions from an existing ACTIVE session. Child sessions inherit the parent's Context Bundle and `ctx_ref` by default but MAY override individual fields, including codec and metadata.

Child sessions are identified by the `CHILD_SESSION` flag (bit 8 of FLAGS) set on all their packets. The SESSION_ID of a child packet is a new UUID; the parent's SESSION_ID is carried in the child HANDSHAKE payload:

```
{
  "parent_session_id": "a3f2b144-...-9d1c",
  "namespace": "org.acme.iot.debug",
  "codec": "json"
}
```

A child session inherits the parent's `ctx_ref` unless the child HANDSHAKE_ACK issues a distinct one. Child sessions are terminated independently; terminating a parent session MUST also terminate all its children.

---

## Fused Sessions

When two sessions are merged via FUSE / FUSE_ACK, the resulting unified stream operates under a merged Context Bundle. Merge rules:

* `namespace`: MUST match between both sessions. A FUSE between sessions with different namespaces MUST be rejected with ERROR `0x0007`.
* `codec`: The FUSE initiator's codec takes precedence in the merged stream.
* `compression`: The FUSE initiator's compression takes precedence.
* `schema_url`: If both are present and differ, the FUSE initiator's value takes precedence.
* `auth_hash`: Both auth hashes are preserved independently. Either credential remains valid.
* `metadata`: Keys are merged. Conflicting keys resolve in favour of the FUSE initiator.

The merged Context Bundle receives a new `ctx_ref` returned in FUSE_ACK. Both original `ctx_ref` handles become aliases for the merged context and remain valid.

---

## Schema URL Convention

The `schema_url` field is informational — AXON does not validate payloads against it. Its purpose is to give implementations and tooling a stable reference for the payload structure.

Recommended format:

```
https://schema.example.org/{namespace-slug}/{version}/{resource}
```

Example:

```
https://schema.acme.org/iot/v2/sensor-reading
```

Schema documents are external to the AXON protocol and their format is not specified here. JSON Schema, Protobuf `.proto` files, and Avro schemas are all common choices.