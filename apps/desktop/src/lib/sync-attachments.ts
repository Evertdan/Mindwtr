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
>;

export async function syncBasicRemoteAttachments(options: BasicRemoteAttachmentSyncOptions): Promise<boolean> {
    const maybeYield = createCooperativeYield(4);
    return await runAttachmentTransferLifecycle({
        ...options,
        beforeEachAttachment: maybeYield,
        resolveLocalPath: stripFileScheme,
        canUploadFrom: await createManagedAttachmentSourcePredicate(),
    });
}
