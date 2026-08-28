/**
 * At-rest sealing for the Origen de trabajo's credential (story 4.1, AD-9).
 *
 * This is the one place in the whole product where the server holds a
 * *user-supplied secret for a third party*. ADR 0025 deliberately rejects
 * first-party encryption for the sync document — the server has to merge that
 * data, and a key the app manages next to the data names no possessor the disk
 * reader isn't already. A Jira API token is a different asset class: the
 * server never merges it, never reads its contents for any purpose other than
 * handing it straight back to Atlassian, and it grants access to a system
 * OUTSIDE Mindwtr. So it gets a real container, with a key the *operator*
 * supplies out of band (see `resolveOriginEncryptionKey` below).
 *
 * Container format — one versioned TEXT column, no sidecar, no key rotation
 * table:
 *
 *     v1.<nonce, 12 bytes, base64url>.<ciphertext||tag, base64url>
 *     AAD = "mindwtr-tdah-origin:v1:" + namespaceKey
 *
 * The AAD binds the ciphertext to the namespace that produced it. A row
 * lifted out of user A's `tdah.sqlite` and pasted into user B's simply fails
 * to open (GCM's tag check covers the AAD), which turns ADR 0026's "strict
 * per-user isolation" from a filesystem convention into something a test can
 * assert. The `v1.` prefix leaves room to rotate the scheme later without a
 * destructive migration: an unknown prefix opens as `null`, which the pull
 * tick already treats as "persist an error code, keep the row".
 *
 * Deliberately NOT `packages/core/src/sync-crypto.ts`: that container is
 * built around a user passphrase and Argon2-style stretching for data the
 * *client* owns. Here the key is a raw 32-byte server secret, so a KDF would
 * add ceremony without adding a possessor.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync } from 'fs';

/** Raw 32-byte key as 64 hex characters. */
export const TDAH_ORIGIN_KEY_ENV_VAR = 'MINDWTR_CLOUD_TDAH_ORIGIN_KEY';
/** Path to a file holding the same 64 hex characters — the `X` + `X_FILE` convention `server-auth.ts` already uses for every other cloud secret. */
export const TDAH_ORIGIN_KEY_FILE_ENV_VAR = `${TDAH_ORIGIN_KEY_ENV_VAR}_FILE`;

const TDAH_ORIGIN_SEAL_VERSION = 'v1';
const TDAH_ORIGIN_AAD_PREFIX = `mindwtr-tdah-origin:${TDAH_ORIGIN_SEAL_VERSION}:`;
const TDAH_ORIGIN_KEY_BYTES = 32;
const TDAH_ORIGIN_NONCE_BYTES = 12;
const TDAH_ORIGIN_TAG_BYTES = 16;
const TDAH_ORIGIN_KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;

const toBase64Url = (bytes: Buffer): string => bytes.toString('base64url');

const fromBase64Url = (value: string): Buffer | null => {
    // `Buffer.from` is famously lenient — it silently truncates at the first
    // invalid character instead of throwing, so a corrupted segment would
    // decode to a short-but-plausible buffer. Round-tripping the result back
    // to base64url and comparing is the cheap way to reject that.
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : null;
};

/**
 * The operator-supplied master key, or `null` when none is configured.
 *
 * `null` is a first-class state, never an error: the routes turn it into a
 * 503 `TDAH_ORIGIN_KEY_UNAVAILABLE` and the pull tick into a persisted
 * `last_error_code`. What must NEVER happen is a fallback that stores the
 * token in clear "just this once" — that is the whole point of failing
 * closed. A malformed value (wrong length, non-hex) is treated exactly like
 * an absent one rather than throwing at import time: a typo in the env should
 * degrade the Origen, not refuse to boot a server whose sync surface is
 * perfectly healthy.
 *
 * Takes `env` as a parameter rather than reading `process.env` directly so
 * tests can exercise present/absent/malformed keys without mutating global
 * process state.
 */
export const resolveOriginEncryptionKey = (env: Record<string, string | undefined>): Buffer | null => {
    const candidates: string[] = [];
    const inline = String(env[TDAH_ORIGIN_KEY_ENV_VAR] ?? '').trim();
    if (inline.length > 0) candidates.push(inline);

    const filePath = String(env[TDAH_ORIGIN_KEY_FILE_ENV_VAR] ?? '').trim();
    if (filePath.length > 0) {
        try {
            const raw = readFileSync(filePath, 'utf8').trim();
            if (raw.length > 0) candidates.push(raw);
        } catch {
            // An unreadable key file is exactly as much "no key configured" as
            // an unset variable — and the caught error is dropped rather than
            // logged, since its `.message` embeds the absolute secret path
            // (AGENTS.md: never a raw fs message).
        }
    }

    for (const candidate of candidates) {
        if (!TDAH_ORIGIN_KEY_HEX_PATTERN.test(candidate)) continue;
        const key = Buffer.from(candidate, 'hex');
        if (key.length === TDAH_ORIGIN_KEY_BYTES) return key;
    }
    return null;
};

const buildAad = (namespaceKey: string): Buffer => Buffer.from(`${TDAH_ORIGIN_AAD_PREFIX}${namespaceKey}`, 'utf8');

/**
 * Seals `plaintext` for `namespaceKey`. A fresh random 12-byte nonce is drawn
 * on EVERY write — never derived from the namespace or a counter — so two
 * writes of the same token under the same key never produce the same
 * ciphertext, and the GCM nonce-reuse catastrophe is structurally
 * unreachable.
 */
export const sealOriginSecret = (key: Buffer, namespaceKey: string, plaintext: string): string => {
    const nonce = randomBytes(TDAH_ORIGIN_NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(buildAad(namespaceKey));
    const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `${TDAH_ORIGIN_SEAL_VERSION}.${toBase64Url(nonce)}.${toBase64Url(sealed)}`;
};

/**
 * Opens a sealed secret, or returns `null` for ANY failure — wrong key, wrong
 * namespace (the AAD check), a truncated/garbled column, an unknown version
 * prefix.
 *
 * Never throws, and in particular never surfaces an error carrying the secret
 * (or the key, or the namespace) in its message: every caller of this
 * function logs, and a thrown OpenSSL error is exactly the kind of value that
 * ends up stringified into a log line. A single `null` return also means
 * callers cannot accidentally branch on *why* it failed and leak that
 * distinction to a client.
 */
export const openOriginSecret = (key: Buffer, namespaceKey: string, sealed: string): string | null => {
    const parts = sealed.split('.');
    if (parts.length !== 3) return null;
    const [version, nonceText, payloadText] = parts as [string, string, string];
    if (version !== TDAH_ORIGIN_SEAL_VERSION) return null;

    const nonce = fromBase64Url(nonceText);
    const payload = fromBase64Url(payloadText);
    if (!nonce || !payload) return null;
    if (nonce.length !== TDAH_ORIGIN_NONCE_BYTES) return null;
    if (payload.length <= TDAH_ORIGIN_TAG_BYTES) return null;

    const ciphertext = payload.subarray(0, payload.length - TDAH_ORIGIN_TAG_BYTES);
    const tag = payload.subarray(payload.length - TDAH_ORIGIN_TAG_BYTES);
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAAD(buildAad(namespaceKey));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
};
