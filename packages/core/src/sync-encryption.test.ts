import { describe, expect, it } from 'vitest';
import {
    SyncEncryptionTerminalError,
    decryptRemoteArtifactOrThrow,
    getSyncEncryptionStatusFromLocalState,
    markRemoteEncryptionDiscovered,
    reaffirmRemoteEncryptionNoKey,
    runChangeSyncEncryptionPassphraseOverRemote,
    runDisableSyncEncryptionOverRemote,
    runEnableSyncEncryptionOverRemote,
    runProvideSyncEncryptionPassphraseOverRemote,
    syncEncryptedArtifactName,
    syncPlaintextArtifactName,
    type SyncEncryptionKeyCachePort,
    type SyncEncryptionLocalState,
    type SyncEncryptionLocalStatePort,
    type SyncEncryptionRemoteEntry,
    type SyncEncryptionRemotePort,
} from './sync-encryption';
import { SYNC_CRYPTO_DEFAULT_KDF_PARAMS, encryptSyncArtifact, deriveSyncKeyMaterial } from './sync-crypto';

// Cheap KDF params for fast tests — deliberately not the production default (mirrors the
// pattern already used by sync-crypto.test.ts fixtures).
const FAST_KDF = { mKib: 8, t: 1, p: 1 };

function createFakeRemote(seed: Record<string, { bytes: Uint8Array; kind: 'document' | 'attachment' }> = {}): SyncEncryptionRemotePort & { store: Map<string, Uint8Array>; kinds: Map<string, 'document' | 'attachment'> } {
    const store = new Map<string, Uint8Array>();
    const kinds = new Map<string, 'document' | 'attachment'>();
    for (const [name, entry] of Object.entries(seed)) {
        store.set(name, entry.bytes);
        kinds.set(name, entry.kind);
    }
    return {
        store,
        kinds,
        async list(): Promise<SyncEncryptionRemoteEntry[]> {
            return [...store.keys()].map((name) => ({ name, kind: kinds.get(name) ?? 'document' }));
        },
        async read(name) {
            return store.has(name) ? store.get(name)! : null;
        },
        async write(name, bytes) {
            store.set(name, bytes);
            if (!kinds.has(name)) kinds.set(name, name.startsWith('attachments/') ? 'attachment' : 'document');
        },
        async remove(name) {
            store.delete(name);
            kinds.delete(name);
        },
    };
}

function createFakeKeyCache(): SyncEncryptionKeyCachePort & { current: Uint8Array | null } {
    const cache: { current: Uint8Array | null } = { current: null };
    return {
        current: null,
        async getKey() {
            return cache.current;
        },
        async setKey(key) {
            cache.current = key;
            (this as { current: Uint8Array | null }).current = key;
        },
        async clearKey() {
            cache.current = null;
            (this as { current: Uint8Array | null }).current = null;
        },
    };
}

function createFakeLocalState(): SyncEncryptionLocalStatePort & { value: SyncEncryptionLocalState | null } {
    const holder: { value: SyncEncryptionLocalState | null } = { value: null };
    return {
        get value() {
            return holder.value;
        },
        read() {
            return holder.value;
        },
        write(state) {
            holder.value = state;
        },
    } as SyncEncryptionLocalStatePort & { value: SyncEncryptionLocalState | null };
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

// Shared with apps/desktop/src-tauri/src/sync_encryption.rs's test module — both languages'
// name mapping must agree on every case, including compound suffix chains (S1: `.bak.previous`
// was previously mis-mapped to `data.json.bak.enc.previous`, a name nothing reads, because the
// old implementation matched only the LAST suffix instead of peeling the full chain).
import artifactNameFixture from './__fixtures__/sync-crypto/artifact-names.json';

describe('sync encryption artifact naming', () => {
    it('matches the shared cross-language fixture in both directions', () => {
        expect(artifactNameFixture.length).toBeGreaterThan(0);
        for (const { plain, encrypted } of artifactNameFixture) {
            expect(syncEncryptedArtifactName(plain)).toBe(encrypted);
            expect(syncPlaintextArtifactName(encrypted)).toBe(plain);
        }
    });

    it('is inverted exactly by syncPlaintextArtifactName', () => {
        for (const name of ['data.json', 'data.json.bak', 'data.json.tmp', 'x.json.previous', 'data.json.bak.previous']) {
            expect(syncPlaintextArtifactName(syncEncryptedArtifactName(name))).toBe(name);
        }
    });

    it('leaves a name with no marker untouched', () => {
        expect(syncPlaintextArtifactName('data.json')).toBe('data.json');
    });
});

describe('runEnableSyncEncryptionOverRemote', () => {
    it('migrates data + bak + snapshot + attachment, verifies, then deletes plaintext', async () => {
        const remote = createFakeRemote({
            'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' },
            'data.json.bak': { bytes: utf8('{"tasks":["old"]}'), kind: 'document' },
            'snapshot-1.json': { bytes: utf8('{"snap":1}'), kind: 'document' },
            'attachments/a1.png': { bytes: utf8('PNGBYTES'), kind: 'attachment' },
        });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();

        await runEnableSyncEncryptionOverRemote('correct horse', remote, keyCache, localState, undefined, undefined);

        // plaintext gone, .enc present, attachment rewritten in place under the same name
        expect(remote.store.has('data.json')).toBe(false);
        expect(remote.store.has('data.json.bak')).toBe(false);
        expect(remote.store.has('snapshot-1.json')).toBe(false);
        expect(remote.store.has('data.json.enc')).toBe(true);
        expect(remote.store.has('data.json.enc.bak')).toBe(true);
        expect(remote.store.has('snapshot-1.json.enc')).toBe(true);
        expect(remote.store.has('attachments/a1.png')).toBe(true);

        expect(localState.value?.state).toBe('enabled');
        const key = await keyCache.getKey();
        expect(key).not.toBeNull();

        const decryptedData = await decryptRemoteArtifactOrThrow(remote.store.get('data.json.enc')!, key!);
        expect(text(decryptedData)).toBe('{"tasks":[]}');
        const decryptedAttachment = await decryptRemoteArtifactOrThrow(remote.store.get('attachments/a1.png')!, key!);
        expect(text(decryptedAttachment)).toBe('PNGBYTES');
    });

    it('is resumable: a mid-transition crash leaves both generations, and a re-run finishes with the same key', async () => {
        const remote = createFakeRemote({
            'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' },
            'data.json.bak': { bytes: utf8('{"tasks":["old"]}'), kind: 'document' },
        });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();

        // Simulate a crash after .bak migrated but before data.json (the base document,
        // migrated last by design) — write its .enc counterpart by hand and leave the
        // plaintext .bak in place, as an interrupted run would.
        const material = await deriveSyncKeyMaterial('correct horse', new Uint8Array(16).fill(7), FAST_KDF);
        const sealedBak = await encryptSyncArtifact(remote.store.get('data.json.bak')!, material);
        remote.store.set('data.json.enc.bak', sealedBak);
        remote.kinds.set('data.json.enc.bak', 'document');
        // plaintext .bak intentionally left in place — this is the "both generations
        // present" state a crash would leave.

        await runEnableSyncEncryptionOverRemote('correct horse', remote, keyCache, localState, undefined, undefined);

        expect(remote.store.has('data.json.bak')).toBe(false);
        expect(remote.store.has('data.json')).toBe(false);
        expect(remote.store.has('data.json.enc')).toBe(true);
        expect(remote.store.has('data.json.enc.bak')).toBe(true);

        // Re-derived key must match the one already embedded in data.json.enc.bak's
        // header (same salt) — decrypting data.json.enc with the cached key proves it.
        const key = (await keyCache.getKey())!;
        const decrypted = await decryptRemoteArtifactOrThrow(remote.store.get('data.json.enc')!, key);
        expect(text(decrypted)).toBe('{"tasks":[]}');
    });

    it('is resumable when the crash happens during the attachment phase, before any document is sealed (self-heals an abandoned salt)', async () => {
        const remote = createFakeRemote({
            'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' },
            'attachments/a1.png': { bytes: utf8('PNGBYTES'), kind: 'attachment' },
        });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();

        // Simulate: a first enable('correct horse') attempt sealed the attachment under
        // an abandoned salt, then crashed before touching data.json at all — no `.enc`
        // document exists yet, so a naive resume would derive a brand-new salt and, on
        // seeing the attachment already looks like ciphertext, wrongly treat it as
        // "already migrated" under the wrong key.
        const abandonedMaterial = await deriveSyncKeyMaterial('correct horse', new Uint8Array(16).fill(42), FAST_KDF);
        remote.store.set('attachments/a1.png', await encryptSyncArtifact(utf8('PNGBYTES'), abandonedMaterial));

        await runEnableSyncEncryptionOverRemote('correct horse', remote, keyCache, localState, undefined, undefined);

        const key = (await keyCache.getKey())!;
        // The attachment must be readable under the key this run actually settled on —
        // not silently left sealed under the abandoned salt.
        const decryptedAttachment = await decryptRemoteArtifactOrThrow(remote.store.get('attachments/a1.png')!, key);
        expect(text(decryptedAttachment)).toBe('PNGBYTES');
        const decryptedData = await decryptRemoteArtifactOrThrow(remote.store.get('data.json.enc')!, key);
        expect(text(decryptedData)).toBe('{"tasks":[]}');
    });

    it('never deletes a plaintext original it could not verify (write failure leaves both generations)', async () => {
        const remote = createFakeRemote({ 'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' } });
        const originalWrite = remote.write.bind(remote);
        let calls = 0;
        remote.write = async (name, bytes) => {
            calls += 1;
            if (name === 'data.json.enc') throw new Error('simulated transport failure');
            return originalWrite(name, bytes);
        };
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();

        await expect(runEnableSyncEncryptionOverRemote('pw', remote, keyCache, localState)).rejects.toThrow('simulated transport failure');
        expect(calls).toBe(1);
        expect(remote.store.has('data.json')).toBe(true); // plaintext untouched
        expect(remote.store.has('data.json.enc')).toBe(false);
        expect(localState.value).toBeNull();
    });
});

describe('runDisableSyncEncryptionOverRemote', () => {
    it('reverts every artifact back to plaintext and clears the cached key', async () => {
        const remote = createFakeRemote({
            'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' },
            'attachments/a1.png': { bytes: utf8('PNGBYTES'), kind: 'attachment' },
        });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();
        await runEnableSyncEncryptionOverRemote('pw', remote, keyCache, localState);

        await runDisableSyncEncryptionOverRemote(remote, keyCache, localState);

        expect(text(remote.store.get('data.json')!)).toBe('{"tasks":[]}');
        expect(text(remote.store.get('attachments/a1.png')!)).toBe('PNGBYTES');
        expect(remote.store.has('data.json.enc')).toBe(false);
        expect(await keyCache.getKey()).toBeNull();
        expect(localState.value).toBeNull();
    });

    it('throws if no key is cached and touches nothing', async () => {
        const remote = createFakeRemote({ 'data.json.enc': { bytes: utf8('whatever'), kind: 'document' } });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();
        await expect(runDisableSyncEncryptionOverRemote(remote, keyCache, localState)).rejects.toThrow();
        expect(remote.store.has('data.json.enc')).toBe(true);
    });
});

describe('runChangeSyncEncryptionPassphraseOverRemote', () => {
    it('re-encrypts every artifact under a fresh salt derived from the new passphrase', async () => {
        const remote = createFakeRemote({
            'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' },
            'attachments/a1.png': { bytes: utf8('PNGBYTES'), kind: 'attachment' },
        });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();
        await runEnableSyncEncryptionOverRemote('old-pw', remote, keyCache, localState);
        const oldSalt = localState.value!.discoveredSalt;

        await runChangeSyncEncryptionPassphraseOverRemote('old-pw', 'new-pw', remote, keyCache, localState);

        expect(localState.value!.discoveredSalt).not.toBe(oldSalt);
        const key = (await keyCache.getKey())!;
        expect(text(await decryptRemoteArtifactOrThrow(remote.store.get('data.json.enc')!, key))).toBe('{"tasks":[]}');
        expect(text(await decryptRemoteArtifactOrThrow(remote.store.get('attachments/a1.png')!, key))).toBe('PNGBYTES');
    });

    it('is resumable when an earlier attempt with the same passphrases left an artifact under an abandoned intermediate salt', async () => {
        const remote = createFakeRemote({
            'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' },
            'attachments/a1.png': { bytes: utf8('PNGBYTES'), kind: 'attachment' },
        });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();
        await runEnableSyncEncryptionOverRemote('old-pw', remote, keyCache, localState);

        // Simulate a first change-passphrase attempt that re-wrapped the attachment under
        // an abandoned intermediate salt, then crashed before touching data.json.enc.
        const abandonedMaterial = await deriveSyncKeyMaterial('new-pw', new Uint8Array(16).fill(99), FAST_KDF);
        remote.store.set('attachments/a1.png', await encryptSyncArtifact(utf8('PNGBYTES'), abandonedMaterial));

        await runChangeSyncEncryptionPassphraseOverRemote('old-pw', 'new-pw', remote, keyCache, localState);

        const key = (await keyCache.getKey())!;
        expect(text(await decryptRemoteArtifactOrThrow(remote.store.get('attachments/a1.png')!, key))).toBe('PNGBYTES');
        expect(text(await decryptRemoteArtifactOrThrow(remote.store.get('data.json.enc')!, key))).toBe('{"tasks":[]}');
    });
});

describe('remote-encrypted-no-key discovery and passphrase provisioning', () => {
    it('discovery persists immediately and survives being read again (reload)', () => {
        const localState = createFakeLocalState();
        markRemoteEncryptionDiscovered(localState, { salt: new Uint8Array(16).fill(1), params: SYNC_CRYPTO_DEFAULT_KDF_PARAMS });
        expect(getSyncEncryptionStatusFromLocalState(localState).state).toBe('remote-encrypted-no-key');
        // "survives reload" — a fresh read of the same port must see the same state.
        expect(localState.read()?.state).toBe('remote-encrypted-no-key');
    });

    it('does not clobber an already-enabled device', () => {
        const localState = createFakeLocalState();
        localState.write({ state: 'enabled', discoveredParams: SYNC_CRYPTO_DEFAULT_KDF_PARAMS });
        markRemoteEncryptionDiscovered(localState, { salt: new Uint8Array(16).fill(2), params: SYNC_CRYPTO_DEFAULT_KDF_PARAMS });
        expect(localState.value?.state).toBe('enabled');
    });

    it('decline re-affirms the no-key state without clearing it', () => {
        const localState = createFakeLocalState();
        markRemoteEncryptionDiscovered(localState, { salt: new Uint8Array(16).fill(3), params: SYNC_CRYPTO_DEFAULT_KDF_PARAMS });
        reaffirmRemoteEncryptionNoKey(localState);
        expect(localState.value?.state).toBe('remote-encrypted-no-key');
    });

    it('wrong passphrase returns wrong-passphrase and never mutates the remote or caches a key', async () => {
        const remote = createFakeRemote({ 'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' } });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();
        await runEnableSyncEncryptionOverRemote('right-pw', remote, keyCache, localState);
        await keyCache.clearKey(); // simulate a fresh device with no cached key
        const before = new Map(remote.store);

        const result = await runProvideSyncEncryptionPassphraseOverRemote('wrong-pw', 'data.json', remote, keyCache, localState);

        expect(result).toBe('wrong-passphrase');
        expect(await keyCache.getKey()).toBeNull();
        expect(remote.store).toEqual(before);
    });

    it('correct passphrase caches the key and clears the no-key state', async () => {
        const remote = createFakeRemote({ 'data.json': { bytes: utf8('{"tasks":[]}'), kind: 'document' } });
        const keyCache = createFakeKeyCache();
        const localState = createFakeLocalState();
        await runEnableSyncEncryptionOverRemote('right-pw', remote, keyCache, localState);
        await keyCache.clearKey();
        markRemoteEncryptionDiscovered(localState, { salt: new Uint8Array(16), params: SYNC_CRYPTO_DEFAULT_KDF_PARAMS });

        const result = await runProvideSyncEncryptionPassphraseOverRemote('right-pw', 'data.json', remote, keyCache, localState);

        expect(result).toBe('ok');
        expect(await keyCache.getKey()).not.toBeNull();
        expect(localState.value?.state).toBe('enabled');
    });
});

describe('fail-closed decrypt', () => {
    it('wraps auth failure (wrong key / tampered ciphertext) as SyncEncryptionTerminalError', async () => {
        const material = await deriveSyncKeyMaterial('pw', new Uint8Array(16), FAST_KDF);
        const sealed = await encryptSyncArtifact(utf8('secret'), material);
        const tampered = new Uint8Array(sealed);
        tampered[tampered.length - 1] ^= 0xff;
        await expect(decryptRemoteArtifactOrThrow(tampered, material.key)).rejects.toBeInstanceOf(SyncEncryptionTerminalError);

        const wrongKey = new Uint8Array(32).fill(9);
        await expect(decryptRemoteArtifactOrThrow(sealed, wrongKey)).rejects.toBeInstanceOf(SyncEncryptionTerminalError);
    });

    // Guard-removed check: without the wrap, the same inputs throw the raw sync-crypto
    // error class instead — proving this test would fail if decryptRemoteArtifactOrThrow
    // stopped reclassifying.
    it('raw decryptSyncArtifact (no wrapper) throws a different class than the terminal wrapper', async () => {
        const { decryptSyncArtifact, SyncCryptoAuthError } = await import('./sync-crypto');
        const material = await deriveSyncKeyMaterial('pw', new Uint8Array(16), FAST_KDF);
        const sealed = await encryptSyncArtifact(utf8('secret'), material);
        const wrongKey = new Uint8Array(32).fill(9);
        await expect(decryptSyncArtifact(sealed, wrongKey)).rejects.toBeInstanceOf(SyncCryptoAuthError);
    });
});
