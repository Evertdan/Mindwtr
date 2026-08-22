import type { AppData, Attachment } from '@mindwtr/core';
import { buildCloudKitAttachmentKey, parseCloudKitAttachmentKey, validateAttachmentForUpload } from '@mindwtr/core';
import {
    deleteCloudKitAttachmentAssets,
    fetchCloudKitAttachmentAsset,
    saveCloudKitAttachmentAsset,
    type CloudKitAttachmentMetadata,
} from '../cloudkit-sync';
import {
    collectAttachments,
    computeAttachmentFileHash,
    extractExtension,
    fileExists,
    getAttachmentByteSize,
    getAttachmentsDir,
    isContentAttachmentUri,
    logAttachmentWarn,
    readAttachmentBytesForUpload,
    readFileAsBytes,
    reportProgress,
    statAttachmentFile,
    validateAttachmentHash,
    writeBytesSafely,
} from '../attachment-sync-utils';
import {
    assertAttachmentSyncNotAborted,
    isAttachmentSyncAbortError,
    migrateAttachmentsLocallyBeforeSync,
    runMobileAttachmentLifecycle,
} from './common';

type OwnedAttachment = {
    ownerType: 'task' | 'project';
    ownerId: string;
    attachment: Attachment;
};

const collectOwnedAttachments = (appData: AppData): OwnedAttachment[] => {
    const owned: OwnedAttachment[] = [];
    for (const task of appData.tasks) {
        if (task.deletedAt) continue;
        for (const attachment of task.attachments ?? []) {
            owned.push({ ownerType: 'task', ownerId: task.id, attachment });
        }
    }
    for (const project of appData.projects) {
        if (project.deletedAt) continue;
        for (const attachment of project.attachments ?? []) {
            owned.push({ ownerType: 'project', ownerId: project.id, attachment });
        }
    }
    return owned;
};

const buildTargetUri = (attachmentsDir: string, attachment: Attachment): string => {
    const ext = extractExtension(attachment.title) || extractExtension(attachment.uri);
    return `${attachmentsDir}${attachment.id}${ext}`;
};

// Handles a content:// uri that reached upload despite the general migration pre-pass — e.g. one
// capped by createAttachmentLocalMigrationLimiter in a PRIOR sync round whose cap has since
// reset. Preserved verbatim from before this file adopted the shared lifecycle.
const ensureCloudKitAssetFile = async (
    attachment: Attachment,
    uri: string,
    attachmentsDir: string,
    signal?: AbortSignal,
): Promise<{ uri: string; size: number | null; mutated: boolean }> => {
    if (!isContentAttachmentUri(uri)) {
        return {
            uri,
            size: await getAttachmentByteSize(attachment, uri),
            mutated: false,
        };
    }

    assertAttachmentSyncNotAborted(signal);
    const result = await readAttachmentBytesForUpload(uri);
    if (result.readFailed) throw result.error;

    const targetUri = buildTargetUri(attachmentsDir, attachment);
    await writeBytesSafely(targetUri, result.data);
    attachment.uri = targetUri;
    attachment.size = result.data.byteLength;
    attachment.localStatus = 'available';
    return { uri: targetUri, size: result.data.byteLength, mutated: true };
};

const buildMetadata = (owned: OwnedAttachment, fileSize: number | null): CloudKitAttachmentMetadata => ({
    attachmentId: owned.attachment.id,
    ownerType: owned.ownerType,
    ownerId: owned.ownerId,
    title: owned.attachment.title,
    ...(owned.attachment.mimeType ? { mimeType: owned.attachment.mimeType } : {}),
    ...(Number.isFinite(fileSize ?? NaN) ? { size: fileSize as number } : {}),
    ...(owned.attachment.fileHash ? { fileHash: owned.attachment.fileHash } : {}),
    updatedAt: owned.attachment.updatedAt,
    ...(owned.attachment.deletedAt ? { deletedAt: owned.attachment.deletedAt } : {}),
});

const applyFetchedMetadata = (attachment: Attachment, metadata: CloudKitAttachmentMetadata): void => {
    if (metadata.title) attachment.title = metadata.title;
    if (metadata.mimeType) attachment.mimeType = metadata.mimeType;
    if (Number.isFinite(metadata.size ?? NaN)) attachment.size = metadata.size;
    if (metadata.fileHash) attachment.fileHash = metadata.fileHash;
};

const flushPendingCloudKitDeletes = async (appData: AppData, signal?: AbortSignal): Promise<boolean> => {
    const pendingDeletes = appData.settings.attachments?.pendingRemoteDeletes ?? [];
    const recordNames: string[] = [];
    const remaining = [];

    for (const pending of pendingDeletes) {
        const recordName = parseCloudKitAttachmentKey(pending.cloudKey);
        if (recordName) recordNames.push(recordName);
        else remaining.push(pending);
    }

    if (recordNames.length === 0) return false;
    assertAttachmentSyncNotAborted(signal);
    await deleteCloudKitAttachmentAssets(recordNames, { signal });

    appData.settings.attachments = {
        ...(appData.settings.attachments ?? {}),
        pendingRemoteDeletes: remaining.length > 0 ? remaining : undefined,
    };
    return true;
};

export const syncCloudKitAttachments = async (
    appData: AppData,
    signal?: AbortSignal,
    options: { activationProbe?: boolean; phase?: 'prepare' | 'post-merge' } = {},
): Promise<boolean> => {
    assertAttachmentSyncNotAborted(signal);
    const attachmentsDir = await getAttachmentsDir();
    if (!attachmentsDir) return false;

    let didMutate = await flushPendingCloudKitDeletes(appData, signal);
    const attachmentsById = collectAttachments(appData);
    if (attachmentsById.size === 0) return didMutate;
    didMutate = (await migrateAttachmentsLocallyBeforeSync(attachmentsById, signal)) || didMutate;

    // Same task/project walk as `attachmentsById`, kept as its own owner-tagged list because
    // CloudKit's upload metadata needs the owning task/project id, which the shared lifecycle's
    // per-attachment callbacks don't carry.
    const ownedByAttachmentId = new Map(
        collectOwnedAttachments(appData).map((owned) => [owned.attachment.id, owned]),
    );

    const syncMutated = await runMobileAttachmentLifecycle({
        attachmentsById,
        localFileExists: fileExists,
        forceUploadExistingLocal: options.activationProbe === true,
        getLocalFileStat: (path) => statAttachmentFile(path),
        computeLocalFileHash: (path) => computeAttachmentFileHash(path),
        contentChangePhase: options.phase,
        isFatalError: (error) => isAttachmentSyncAbortError(error, signal),
        // A cloudKey written by a different backend before a provider switch isn't a valid
        // CloudKit record key, so CloudKit must still treat the attachment as needing upload.
        hasCloudCopy: (attachment) => Boolean(parseCloudKitAttachmentKey(attachment.cloudKey)),
        onUpload: async (attachment, localPath) => {
            const owned = ownedByAttachmentId.get(attachment.id);
            if (!owned) return false;
            try {
                const assetFile = await ensureCloudKitAssetFile(attachment, localPath, attachmentsDir, signal);
                const validation = await validateAttachmentForUpload(attachment, assetFile.size ?? attachment.size);
                if (!validation.valid) {
                    reportProgress(attachment.id, 'upload', 0, attachment.size ?? 0, 'failed', validation.error);
                    logAttachmentWarn(`Attachment validation failed (${validation.error}) for ${attachment.id}`);
                    return assetFile.mutated;
                }

                const totalBytes = Math.max(0, Number(assetFile.size ?? attachment.size ?? 0));
                reportProgress(attachment.id, 'upload', 0, totalBytes, 'active');
                await saveCloudKitAttachmentAsset(
                    attachment.id,
                    assetFile.uri,
                    buildMetadata(owned, assetFile.size),
                    { signal },
                );
                attachment.cloudKey = buildCloudKitAttachmentKey(attachment.id);
                // localStatus is already 'available' here: onUpload only runs when the
                // lifecycle's own existsLocally check just passed, which is what set it.
                if (Number.isFinite(assetFile.size ?? NaN)) attachment.size = assetFile.size ?? undefined;
                reportProgress(attachment.id, 'upload', totalBytes, totalBytes, 'completed');
                return true;
            } catch (error) {
                if (isAttachmentSyncAbortError(error, signal)) throw error;
                reportProgress(
                    attachment.id,
                    'upload',
                    0,
                    attachment.size ?? 0,
                    'failed',
                    error instanceof Error ? error.message : String(error),
                );
                logAttachmentWarn(`Failed to upload CloudKit attachment ${attachment.id}`, error);
                return false;
            }
        },
        onUploadError: () => {
            // onUpload's own catch above handles everything except the fatal (abort) case,
            // which it rethrows — that never reaches here. Required by the lifecycle's contract.
        },
        onDownload: async (attachment) => {
            const recordName = parseCloudKitAttachmentKey(attachment.cloudKey);
            if (!recordName) return false;
            try {
                const targetUri = buildTargetUri(attachmentsDir, attachment);
                reportProgress(attachment.id, 'download', 0, attachment.size ?? 0, 'active');
                const metadata = await fetchCloudKitAttachmentAsset(recordName, targetUri, { signal });
                const bytes = await readFileAsBytes(targetUri);
                await validateAttachmentHash(attachment, bytes);
                attachment.uri = targetUri;
                attachment.localStatus = 'available';
                applyFetchedMetadata(attachment, metadata);
                reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
                return true;
            } catch (error) {
                if (isAttachmentSyncAbortError(error, signal)) throw error;
                reportProgress(
                    attachment.id,
                    'download',
                    0,
                    attachment.size ?? 0,
                    'failed',
                    error instanceof Error ? error.message : String(error),
                );
                logAttachmentWarn(`Failed to download CloudKit attachment ${attachment.id}`, error);
                return false;
            }
        },
        onDownloadError: () => {},
    });

    return didMutate || syncMutated;
};
