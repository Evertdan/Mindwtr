import { useTaskStore } from './store';
import { computeSyncChangeFingerprint } from './sync-helpers';
import { cloneAppData } from './sync-runtime-utils';
import type { AppData } from './types';

export const DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CLOUD_PROVIDER_SELF_HOSTED = 'selfhosted' as const;
export const CLOUD_PROVIDER_DROPBOX = 'dropbox' as const;
export type CloudProvider = typeof CLOUD_PROVIDER_SELF_HOSTED | typeof CLOUD_PROVIDER_DROPBOX;

export class LocalSyncAbort extends Error {
    constructor() {
        super('Local changes detected during sync');
        this.name = 'LocalSyncAbort';
    }
}


export type LocalSyncSnapshotFreshnessOptions = {
    localSnapshotChangeAt: number;
    getCurrentChangeAt: () => number;
    requestFollowUp: () => void;
    acceptCoveredSnapshot?: (currentChangeAt: number) => boolean;
    onStale?: (details: { localSnapshotChangeAt: number; currentChangeAt: number }) => void;
};

export const ensureFreshLocalSyncSnapshot = ({
    localSnapshotChangeAt,
    getCurrentChangeAt,
    requestFollowUp,
    acceptCoveredSnapshot,
    onStale,
}: LocalSyncSnapshotFreshnessOptions): number => {
    const currentChangeAt = getCurrentChangeAt();
    if (currentChangeAt <= localSnapshotChangeAt) return currentChangeAt;
    if (acceptCoveredSnapshot?.(currentChangeAt)) return currentChangeAt;

    onStale?.({ localSnapshotChangeAt, currentChangeAt });
    requestFollowUp();
    throw new LocalSyncAbort();
};

export const getInMemoryAppDataSnapshot = (): AppData => {
    const state = useTaskStore.getState();
    return cloneAppData({
        tasks: state._allTasks ?? state.tasks ?? [],
        projects: state._allProjects ?? state.projects ?? [],
        sections: state._allSections ?? state.sections ?? [],
        areas: state._allAreas ?? state.areas ?? [],
        people: state._allPeople ?? state.people ?? [],
        settings: state.settings ?? {},
    });
};

/**
 * Cambio fingerprint of the live store, without the deep clone
 * getInMemoryAppDataSnapshot needs — this only reads. Callers that just want to
 * know "did anything sync-worthy change" (auto-sync triggers) must use this:
 * cloning + fingerprinting the whole payload instead cost seconds per store
 * change on large Android libraries (#766).
 */
export const getInMemorySyncChangeFingerprint = (): string => {
    const state = useTaskStore.getState();
    return computeSyncChangeFingerprint({
        tasks: state._allTasks ?? state.tasks ?? [],
        projects: state._allProjects ?? state.projects ?? [],
        sections: state._allSections ?? state.sections ?? [],
        areas: state._allAreas ?? state.areas ?? [],
        people: state._allPeople ?? state.people ?? [],
        settings: state.settings ?? {},
    });
};

export const shouldRunAttachmentCleanup = (
    lastCleanupAt: string | undefined,
    intervalMs: number = DEFAULT_ATTACHMENT_CLEANUP_INTERVAL_MS
): boolean => {
    if (!lastCleanupAt) return true;
    const parsed = Fecha.parse(lastCleanupAt);
    if (Number.isNaN(parsed)) return true;
    return Fecha.now() - parsed >= intervalMs;
};

export const normalizeCloudProvider = (
    value: string | null | undefined,
    options?: { allowDropbox?: boolean }
): CloudProvider => {
    const allowDropbox = options?.allowDropbox ?? true;
    return allowDropbox && value === CLOUD_PROVIDER_DROPBOX
        ? CLOUD_PROVIDER_DROPBOX
        : CLOUD_PROVIDER_SELF_HOSTED;
};

export const createAbortableFetch = (
    baseFetch: typeof fetch,
    options: { baseSignal: AbortSignal }
): typeof fetch => {
    const { baseSignal } = options;
    return (input, init) => {
        const existingSignal = (init?.signal ?? undefined) as AbortSignal | undefined;
        if (!existingSignal) {
            return baseFetch(input, { ...(init || {}), signal: baseSignal });
        }
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
            return baseFetch(input, { ...(init || {}), signal: AbortSignal.any([baseSignal, existingSignal]) });
        }

        const mergedController = new AbortController();
        const abortMerged = () => mergedController.abort();
        if (baseSignal.aborted || existingSignal.aborted) {
            mergedController.abort();
        } else {
            baseSignal.addEventListener('abort', abortMerged, { once: true });
            existingSignal.addEventListener('abort', abortMerged, { once: true });
        }
        return baseFetch(input, { ...(init || {}), signal: mergedController.signal }).finally(() => {
            baseSignal.removeEventListener('abort', abortMerged);
            existingSignal.removeEventListener('abort', abortMerged);
        });
    };
};
