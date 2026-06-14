# Contributing

Thanks for taking an interest in contributing.

AXON is an open protocol specification developed under the `axon-prot` Github organisation. This repository (`spec`) contains the normative protocol specification, conformance suite, schemas, and supporting documentation.

The goal of AXON is to define a binary, full-duplex, transport-agnostic data exchange protocol with first-class support for capability discovery, semantic expiry, session fusion, state synchronisation, and data revocation.

Contributions of all kinds are welcome as long as they meaningfully improve the protocol, its documentation, or the conformance suite.

---

## Getting Started

### Requirements

* Git
* Node.js (Latest LTS recommended) — for the conformance test runner
* A text editor with Markdown support

### Setup

Clone the specification repository:

```bash
git clone https://github.com/axon-prot/spec.git
cd spec
```

Install conformance runner dependencies:

```bash
cd conformance/runner
npm install
```

Run the conformance suite against a local implementation:

```bash
npm test -- --endpoint ws://localhost:4200
```

---

## Repository Structure

This repository contains several components related to the AXON specification:

```text
spec/           Normative specification documents. Changes here affect the protocol.
conformance/    Transport-agnostic conformance test suite. Language-independent.
schemas/        Formal JSON schemas for structured payloads (capability descriptors, context bundles).
examples/       Annotated packet dumps and exchange flows. Non-normative.
```

Within the `axon-prot` GitHub organisation, this repository serves as the canonical source for the AXON specification and protocol conformance materials.

---

## Types of Contribution

### Specification changes

Changes to documents under `spec/` affect the protocol itself. These carry the highest bar for review.

Before opening a merge request for a spec change, open an issue first to describe the problem and your proposed approach. Spec changes that lack prior discussion are unlikely to be merged quickly.

Spec MRs must include:
- A clear problem statement (what existing behaviour is broken, ambiguous, or missing)
- The proposed normative change (MUST / SHOULD / MAY language where applicable)
- At least one conformance test case under `conformance/cases/` that covers the change
- Updates to any affected wiki pages

### Conformance test cases

New test cases under `conformance/cases/` are always welcome and have a lower barrier than spec changes. If you find behaviour that the suite does not cover, a test case addition is the best first step — even if you are unsure whether the behaviour should be required.

### Schema additions

Additions or corrections to `schemas/` should reference the relevant section of the spec and include an example instance document.

### Documentation and examples

Improvements to wiki pages, the README, and `examples/` are treated as standard MRs. No issue required for purely editorial changes.

---

## Spec Proposals

For significant additions (new signal types, new flag bits, changes to packet layout), the preferred process is:

1. Open an issue with the `proposal` label describing the motivation and rough design
2. Discussion on the issue until rough consensus is reached
3. Open a draft MR with the full spec text, schema changes, and conformance cases
4. Review period (minimum one week for breaking changes)
5. Merge on maintainer sign-off

Signal codes 0x10–0xFE and flag bits 10–15 are currently reserved. Proposals claiming values from these spaces must go through the full proposal process.

---

## Testing

The conformance suite lives in `conformance/` and is designed to be run against any AXON implementation regardless of language.

```bash
cd conformance/runner
npm test -- --endpoint <transport>://<host>:<port>
```

Test case definitions are plain JSON files under `conformance/cases/`. Each case specifies the input packet sequence, expected output signals, and the conformance level it tests.

When contributing:

- Add test cases alongside any spec change
- Prefer small, focused cases that test one behaviour
- Ensure existing cases continue to pass
- Avoid cases that depend on timing unless testing a time-bounded feature (e.g. STALE_AT)

---

## Style

Specification prose follows RFC conventions for normative language:

- **MUST** / **MUST NOT** — absolute requirements
- **SHOULD** / **SHOULD NOT** — strong recommendations with acknowledged exceptions
- **MAY** — optional behaviour

Use these terms consistently and precisely. Avoid synonyms like "has to", "needs to", or "ought to" in normative context.

Markdown in `spec/` is linted with `markdownlint`. Run it before opening a MR:

```bash
npx markdownlint spec/
```

---

## Git Workflow

- Work in feature branches
- Open a merge request for all changes
- Keep changes focused and reviewable

### Commit conventions

We follow conventional commit style. Each commit should represent a single logical change and leave the repository in a working state.

Preferred prefixes:

- `feat:` new signal, flag, or protocol behaviour
- `fix:` correction to existing spec text
- `refactor:` restructuring without semantic change
- `test:` conformance test additions or changes
- `docs:` wiki, README, or example updates
- `chore:` tooling or maintenance
- `schema:` changes to formal schemas

### Commit quality rules

- Keep commits small and focused
- Separate spec changes, test cases, and documentation when possible
- Avoid mixed-purpose commits (e.g. spec change + unrelated test fix)
- Ensure the conformance runner passes before pushing

A clear history matters more than minimising commit count.

### Merge Requests

When opening a merge request:

- Clearly describe the motivation behind the change
- Link the originating issue if one exists
- Include conformance test cases for any normative change
- Highlight any breaking changes to the wire format or signal semantics
- Keep the diff focused and reviewable

---

## Versioning

This project follows semantic versioning applied to the protocol specification:

- Breaking changes to the wire format or signal semantics → major version bump
- New signals, flags, or optional behaviours → minor version bump
- Clarifications and non-normative corrections → patch version bump

---

## Issues

If you are unsure about a change, open an issue first.

Good issue types:

- Ambiguity or contradiction in the spec text
- Missing normative behaviour (cases the spec does not address)
- Proposals for new signals or flag bits
- Conformance test gaps
- Implementation experience reports (what was hard to implement and why)

Maintainer: Ashley <ashley@nullworks.dev>