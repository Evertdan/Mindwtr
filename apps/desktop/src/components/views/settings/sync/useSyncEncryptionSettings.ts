import { useCallback, useEffect, useState } from 'react';

import { generateDicewarePassphrase, type SyncBackend, type SyncEncryptionTransitionProgress } from '@mindwtr/core';

import { logError } from '../../../../lib/app-log';
import { isSyncEncryptionFailure } from '../../../../lib/sync-encryption-service';
import { SyncService } from '../../../../lib/sync-service';
import type { CloudProvider, SyncEncryptionController, SyncEncryptionErrorKind } from './types';

// Encryption covers la backends Mindwtr writes whole blobs to. uno mismo-hosted cloud
// y CloudKit hold structured server-side estado instead, por lo que phase 2's API rejects
// ellos outright — esto predicate keeps la section desde ever offering la choice.
export const isEncryptionCapableBackend = (backend: SyncBackend, cloudProvider: CloudProvider): boolean => (
    backend === 'file' || backend === 'webdav' || (backend === 'cloud' && cloudProvider === 'dropbox')
);

// A mistyped current passphrase es caught by la explicit verify below and
// carries its own sentinel — by la tiempo la rotation itself fails, the
// passphrase has already sido proven, por lo que blaming it es a lie la reporter of
// #1056 nearly chased. Rotation failures fall a través de to la genérico message.
// Disable stays special: it no puede uno mismo-heal a folder an interrupted rotation
// left on two salts, y la solo forma out es to finish la rotation first.
export const classifyFailure = (error: unknown, terminal: SyncEncryptionErrorKind): SyncEncryptionErrorKind => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    if (message.includes('SYNC_ENCRYPTION_WRONG_PASSPHRASE')) return 'wrong-passphrase';
    return isSyncEncryptionFailure(error) ? terminal : 'generic';
};

export function useSyncEncryptionSettings(
    syncBackend: SyncBackend,
    cloudProvider: CloudProvider,
): SyncEncryptionController {
    const supported = isEncryptionCapableBackend(syncBackend, cloudProvider);
    const [state, setState] = useState<SyncEncryptionController['state']>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<SyncEncryptionTransitionProgress | null>(null);
    const [error, setError] = useState<SyncEncryptionErrorKind | null>(null);

    // A status read que failed says nothing acerca de la folder; reporting 'off'
    // sería offer "Enable encryption" for a folder que puede already be encrypted.
    // null renders la section empty hasta a later read succeeds.
    const readState = useCallback(async (): Promise<SyncEncryptionController['state']> => {
        try {
            return (await SyncService.getSyncEncryptionStatus()).state;
        } catch (failure) {
            void logError(failure, { scope: 'sync-encryption', step: 'status' });
            return null;
        }
    }, []);

    useEffect(() => {
        if (!supported) {
            setState(null);
            return;
        }
        let cancelled = false;
        void readState().then((next) => {
            if (!cancelled) setState(next);
        });
        return () => {
            cancelled = true;
        };
    }, [readState, supported]);

    const run = useCallback(async (
        operation: (onProgress: (value: SyncEncryptionTransitionProgress) => void) => Promise<void>,
        terminal: SyncEncryptionErrorKind,
    ): Promise<boolean> => {
        setBusy(true);
        setError(null);
        setProgress(null);
        let succeeded = false;
        try {
            await operation(setProgress);
            succeeded = true;
        } catch (failure) {
            void logError(failure, { scope: 'sync-encryption', step: 'transition' });
            setError(classifyFailure(failure, terminal));
        }
        // Whether it finished o not, la device's estado puede tienen moved: every
        // transition es resumable, por lo que a half-done ejecución todavía has to be reflected.
        setState(await readState());
        setProgress(null);
        setBusy(false);
        return succeeded;
    }, [readState]);

    const enable = useCallback((passphrase: string) => run(
        (onProgress) => SyncService.enableSyncEncryption(passphrase, onProgress),
        'generic',
    ), [run]);

    const disable = useCallback(() => run(
        (onProgress) => SyncService.disableSyncEncryption(onProgress),
        'rotation-first',
    ), [run]);

    const changePassphrase = useCallback((current: string, next: string) => run(
        (onProgress) => SyncService.changeSyncEncryptionPassphrase(current, next, onProgress),
        'generic',
    ), [run]);

    const unlock = useCallback(async (passphrase: string): Promise<boolean> => {
        setBusy(true);
        setError(null);
        let accepted = false;
        try {
            accepted = (await SyncService.provideSyncEncryptionPassphrase(passphrase)) === 'ok';
            if (!accepted) setError('wrong-passphrase');
        } catch (failure) {
            void logError(failure, { scope: 'sync-encryption', step: 'unlock' });
            setError(classifyFailure(failure, 'wrong-passphrase'));
        }
        setState(await readState());
        setBusy(false);
        return accepted;
    }, [readState]);

    const decline = useCallback(async () => {
        try {
            await SyncService.declineSyncEncryptionPassphrase();
        } catch (failure) {
            void logError(failure, { scope: 'sync-encryption', step: 'decline' });
        }
        setState(await readState());
    }, [readState]);

    return {
        state,
        supported,
        busy,
        progress,
        error,
        clearError: useCallback(() => setError(null), []),
        generatePassphrase: useCallback(() => generateDicewarePassphrase(), []),
        enable,
        disable,
        changePassphrase,
        unlock,
        decline,
    };
}
