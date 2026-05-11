# ADR 0000: Record Architecture Decisions

## Status

Accepted

## Context

We need a lightweight way to record architectural decisions made on this
project so that future contributors can understand *why* a particular
design was chosen, not just *what* the code currently does.

## Decision

We will use Architecture Decision Records (ADRs), as described by Michael
Nygard in
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Each ADR is a short Markdown file under `docs/adr/` with the filename
shape `NNNN-<short-title>.md` (zero-padded sequence number). Every ADR
carries the four standard sections:

- **Status** — `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-NNNN`
- **Context** — the forces at play, including technological, business,
  and team constraints.
- **Decision** — the change we are making.
- **Consequences** — the resulting context after applying the decision,
  both positive and negative.

When a later ADR supersedes an earlier one, the older ADR's `Status`
section is updated to `Superseded by ADR-NNNN` and a back-link is added.
The older file is *not* deleted; the historical record matters.

## Consequences

- Future architectural decisions in this repo will be recorded as
  `docs/adr/NNNN-<short-title>.md` files. The `0000` record is the
  meta-ADR documenting the convention itself.
- Code reviewers can ask "is there an ADR for this?" as part of normal
  review for any non-trivial design choice.
- Historical context survives author turnover; new contributors can
  read `docs/adr/` chronologically to understand how the system reached
  its current shape.
