# 017 — Record the encryption-at-rest stance as an ADR

Base: 0e4021faa · Finding: DOCS-01 (improve audit 2026-08-13) · One commit.

## Context
docs/adr/ holds 24 ADRs densely covering sync/storage, but the most re-argued decision — encryption-at-rest — has none. The stance is settled (discussion #1001): first-party E2E encryption is never promised; a blob-backend PR is welcome; the decline rests on a precise key-ownership claim that must be restated carefully every time (getting it loose in a public reply is a security-claims problem — see the repo's security-claims rigor rule: verify against code and name key ownership before ANY public encryption claim).

## Steps
1. Read the existing stance sources: the #1001 discussion record (repo memory file if accessible, else the public discussion), ADR template/format used by the newest ADRs in docs/adr/, and the guardrails' related constraints (never require canonicalize on virtual FS, etc. — adjacent but distinct; do not fold them in).
2. Write one ADR: context (threat model actually addressed: device theft/at-rest disk access vs. server operator trust), decision (rely on platform-level encryption; sync payload encryption not first-party; pluggable blob-backend contribution path welcome), the key-ownership argument stated precisely (who holds keys in each proposed scheme and why that breaks the promise), consequences, and what evidence would reopen the decision.
3. Status: Accepted, dated to when the stance was actually settled (cite #1001), not today.
4. OPTIONAL second/third ADRs for P2P transport decline and OIDC decline ONLY if they fit the same session cheaply — separate commits if so.

## Scope
In: docs/adr/NNNN-*.md (next free number) + the ADR index if one exists. Out: public web docs (nothing user-facing changes), SECURITY.md (settled).

## Gates
None mechanical beyond `git diff --check`; the coordinator reviews wording against the security-claims rigor rule BEFORE commit — flag any sentence you are less than certain about.
