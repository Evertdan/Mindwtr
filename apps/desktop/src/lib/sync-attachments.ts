import {
    runAttachmentTransferLifecycle,
    type AttachmentTransferLifecycleOptions,
} from '@mindwtr/core';
import {
    createCooperativeYield,
    createManagedAttachmentSourcePredicate,
    stripFileScheme,
} from './sync-service-utils';

export {
    collectAttachmentsById,
    getBaseSyncUrl,
    getCloudBaseUrl,
    normalizePendingRemoteDeletes,
    reportProgress,
    validateAttachmentHash,
} from '@mindwtr/core';

type BasicRemoteAttachmentSyncOptions = Omit<
    AttachmentTransferLifecycleOptions,
    'beforeEachAttachment' | 'resolveLocalPath' | 'canUploadFrom'
> & {
    /**
     * The sync run's freshness guard, checked between attachments exactly like the
     * cleanup lifecycle does (sync-attachment-cleanup.ts). The run re-checks freshness
     * before persisting either way, so this is not what keeps a local edit safe — it is
     * what stops a pass from working through every remaining transfer before the run
     * discovers the snapshot is stale and requeues.
     */
    ensureLocalSnapshotFresh?: () => void;
};

export async function syncBasicRemoteAttachments({
    ensureLocalSnapshotFresh,
    ...options
}: BasicRemoteAttachmentSyncOptions): Promise<boolean> {
    const maybeYield = createCooperativeYield(4);
    return await runAttachmentTransferLifecycle({
        ...options,
        beforeEachAttachment: async () => {
            await maybeYield();
            ensureLocalSnapshotFresh?.();
        },
        resolveLocalPath: stripFileScheme,
        canUploadFrom: await createManagedAttachmentSourcePredicate(),
    });
}
