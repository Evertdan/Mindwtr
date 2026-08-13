# 25. No first-party sync-payload encryption; pluggable encrypted backends welcome

Date: 2026-08-06

## Status

Accepted

Settled in discussion #1001. Dated to when the stance was decided, not to when
this record was written.

## Context

"Encrypt the data at rest" is the most re-argued request in the tracker, and it
arrives as one sentence covering two different threat models that need
separating before anything can be decided.

**Device theft / offline disk access.** Mindwtr stores its data in SQLite in the
app's own directory. On modern iOS and Android that directory is encrypted at
rest by the OS (iOS Data Protection, Android file-based encryption). On desktop
it is protected exactly when the user has disk encryption enabled — FileVault on
macOS, BitLocker on Windows, LUKS on Linux — which is the default on current
macOS, common but not universal on Windows, and an install-time choice on Linux.
App-level encryption with an app-managed key would not improve on the unencrypted
cases: the key would have to live on the same disk (see below). This threat model
belongs to the platform's disk encryption, and Mindwtr must never claim to add
protection there that it does not have.

**Server-operator access.** The self-hosted cloud sync server (ADR 0010) stores
the synced document as JSON on disk. An operator with filesystem access can read
it. For a self-hosted deployment the operator is usually the user, so this is
the same trust boundary as the device; for a shared or hosted deployment it is a
genuinely different one.

The security-claims rigor rule applies to every sentence below: an encryption
claim is only worth making if it names who holds the key.

## Decision

Mindwtr does not offer first-party encryption of the sync payload, in either the
app-managed-key or the user-held-key form. A pluggable encrypted storage backend
contributed by a user remains welcome.

### Why app-managed keys are not worth shipping

In an app-managed scheme, Mindwtr generates the key and stores it so the app can
decrypt without the user typing anything. That key has to live on every synced
device, in the app's own storage, beside the data it protects. An attacker who
can read the database file can read the key from the same place — so the scheme
protects against nothing the platform's disk encryption does not already cover.
It would let us put the word "encrypted" on a feature list, which is exactly the
kind of claim the rigor rule exists to stop. The honest description of that
feature is "obfuscated", and it costs real complexity in key rotation, backup,
restore, and multi-device onboarding to buy it.

### Why user-held keys break server-side merge

In a true end-to-end scheme the user holds a key the server never sees. That is
a real security property — and it is incompatible with how sync works today.

The cloud server does not store an opaque blob. `PUT /v1/data`
(`apps/cloud/src/server.ts`) validates the incoming body as an `AppData`
structure and then calls `mergeAppDataWithStats(existingData, incomingData)`,
merging **per entity, revision-wise**: for each task, project, section, area and
person it compares the incoming `rev` against the stored one and resolves
field-by-field, with deterministic tombstone handling. It writes the merged
result, not the payload it received. Two devices that both sync while offline
converge because the server can read and reconcile both documents.

A server holding ciphertext can do none of that. It cannot compare revisions, so
it cannot merge; the only operation left is last-writer-wins on the whole
document, which silently discards the other device's concurrent edits — the
exact data-loss class the revision-aware design (ADR 0003) exists to prevent.
Preserving E2E and multi-device merge together means moving the merge to the
clients: a different sync architecture, in CRDT territory, which ADR 0017
deliberately defers.

### What is welcome instead

A **pluggable encrypted blob backend** — an alternative sync target (rclone
crypt, an encrypted WebDAV/S3 remote, or similar) that the file-sync path writes
through. This moves the tradeoff to the user who chooses it: they accept
whole-document last-writer-wins semantics in exchange for the server never
seeing plaintext, and they hold their own key. A contribution along those lines
is welcome. We will not promise it as a first-party feature, because doing so
would put us back to managing keys we should not hold.

## Consequences

Data at rest on a device is protected by the platform, and the app makes no
encryption claim of its own — public replies say "the platform encrypts it",
never "Mindwtr encrypts it". Users who need the server to be untrusted
self-host it, or use a file-sync backend they encrypt themselves. The
revision-aware server merge stays intact, which is what makes concurrent
multi-device editing converge without losing edits.

The cost is real: a hosted deployment's operator can read the document, and
Mindwtr cannot advertise E2E encryption. Anyone whose threat model includes an
untrusted server operator must self-host or encrypt the transport target
themselves.

## What would reopen this

- Sync moving to client-side merge (CRDT or equivalent, per ADR 0017), which
  removes the server's need to read the document and makes E2E compatible with
  multi-device convergence.
- A contributed blob backend proving the encrypted-target path is maintainable,
  which would make it worth documenting as a supported configuration — still
  user-keyed, still not a first-party key-management promise.
- A first-party hosted service, which would change the operator trust boundary
  from "the user" to "us" and force the question again on different terms.
