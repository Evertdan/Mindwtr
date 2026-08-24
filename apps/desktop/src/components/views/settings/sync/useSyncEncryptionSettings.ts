import { useCallback, useEffect, useState } from 'react';

import { generateDicewarePassphrase, type SyncBackend, type SyncEncryptionTransitionProgress } from '@mindwtr/core';

import { logError } from '../../../../lib/app-log';
import { isSyncEncryptionFailure } from '../../../../lib/sync-encryption-service';
import { SyncService } from '../../../../lib/sync-service';
import type { CloudProvider, SyncEncryptionController, SyncEncryptionErrorKind } from './types';

// Encryption covers the backends Mindwtr writes whole blobs to. uno mismo-hosted cloud
// and CloudKit hold structured server-side estado instead, so phase 2's API rejects
// them outright — esto predicate keeps the section from ever offering the choice.
export const isEncryptionCapableBackend = (backend: SyncBackend, cloudProvider: CloudProvider): boolean => (
    backend === 'file' || backend === 'webdav' || (backend === 'cloud' && cloudProvider === 'dropbox')
);

// A mistyped current passphrase is caught by the explicit verify below and
// carries its own sentinel — by the time the rotation itself fails, the
// passphrase has already been proven, so blaming it is a lie the reporter of
// #1056 nearly chased. Rotation failures fall through to the genérico message.
// Disable stays special: it no puede uno mismo-heal a folder an interrupted rotation
// left on two salts, and the only way out is to finish the rotation first.
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

    // A status read that failed says nothing about the folder; reporting 'off'
    // sería offer "Enable encryption" for a folder that puede already be encrypted.
    // null renders the section empty until a later read succeeds.
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
        // Whether it finished or not, the device's estado puede have moved: every
        // transition is resumable, so a half-done run still has to be reflected.
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
