import {
    type AppData,
    type Attachment,
    type SyncRunAttachmentHelpers,
    createWebdavDownloadBackoff,
    buildCloudKitAttachmentKey,
    cloudGetFile,
    cloudPutFile,
    computeSha256Hex,
    getErrorStatus,
    isWebdavRateLimitedError,
    parseCloudKitAttachmentKey,
    validateAttachmentForUpload,
    webdavFileExists,
    webdavGetFile,
    webdavMakeDirectory,
    webdavPutFile,
    withRetry,
} from '@mindwtr/core';

import { sanitizeLogMessage } from './app-log';
import {
    collectAttachmentsById,
    reportProgress,
    syncBasicRemoteAttachments,
    validateAttachmentHash,
} from './sync-attachments';
import {
    ATTACHMENTS_DIR_NAME,
    buildCloudKey,
    createLocalAttachmentFs,
    extractExtension,
    resolveFileBackendPath,
    sleep,
    stripFileScheme,
    createCooperativeYield,
    writeFileSafelyAbsolute,
} from './sync-service-utils';
import { getManagedPath } from './managed-paths';
import {
    exists as syncFsExists,
    mkdir as syncFsMkdir,
    remove as syncFsRemove,
    rename as syncFsRename,
    stat as syncFsStat,
} from './sync-fs';
import {
    clearAttachmentValidationFailure,
    handleAttachmentValidationFailure,
    markAttachmentUnrecoverable,
} from './sync-attachment-validation';
import { openAttachmentBytes, sealAttachmentBytes } from './sync-encryption-service';
import {
    downloadDropboxFile,
    DropboxFileNotFoundError,
    DropboxUnauthorizedError,
    uploadDropboxFile,
} from './dropbox-sync';
import {
    deleteCloudKitAttachmentAssets,
    fetchCloudKitAttachmentAsset,
    saveCloudKitAttachmentAsset,
    type CloudKitAttachmentMetadata,
} from './cloudkit-sync';

export type WebDavConfig = {
    url: string;
    username: string;
    password?: string;
    hasPassword?: boolean;
    allowInsecureHttp?: boolean;
    allowWeakFingerprint?: boolean;
};
export type CloudConfig = {
    url: string;
    token: string;
    allowInsecureHttp?: boolean;
    rememberToken?: boolean;
};

export type AttachmentBackendDeps = {
    getTauriFetch: () => Promise<typeof fetch | undefined>;
    isTauriRuntimeEnv: () => boolean;
    logSyncInfo: (message: string, extra?: Record<string, string>) => void;
    logSyncWarning: (message: string, error?: unknown) => void;
    resolveWebdavPassword: (config: WebDavConfig) => Promise<string>;
};

const FILE_BACKEND_VALIDATION_CONFIG = {
    maxFileSizeBytes: Number.POSITIVE_INFINITY,
    blockedMimeTypes: [],
};
const UPLOAD_TIMEOUT_MS = 120_000;
const WEBDAV_ATTACHMENT_RETRY_OPTIONS = {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60_000,
};
const CLOUD_ATTACHMENT_RETRY_OPTIONS = {
    maxAttempts: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60_000,
};
const WEBDAV_ATTACHMENT_MIN_INTERVAL_MS = 400;
const WEBDAV_ATTACHMENT_COOLDOWN_MS = 60_000;
const WEBDAV_ATTACHMENT_MAX_DOWNLOADS_PER_SYNC = 10;
const WEBDAV_ATTACHMENT_MAX_UPLOADS_PER_SYNC = 10;
const WEBDAV_ATTACHMENT_MISSING_BACKOFF_MS = 15 * 60_000;
const WEBDAV_ATTACHMENT_ERROR_BACKOFF_MS = 2 * 60_000;

const webdavDownloadBackoff = createWebdavDownloadBackoff({
    missingBackoffMs: WEBDAV_ATTACHMENT_MISSING_BACKOFF_MS,
    errorBackoffMs: WEBDAV_ATTACHMENT_ERROR_BACKOFF_MS,
});
let webdavAttachmentRateLimitedUntil = 0;

export const clearAttachmentSyncState = (): void => {
    webdavDownloadBackoff.clear();
    webdavAttachmentRateLimitedUntil = 0;
};

const getWebdavAttachmentRateLimitRemainingMs = (): number => Math.max(0, webdavAttachmentRateLimitedUntil - Date.now());

const markWebdavAttachmentRateLimited = (
    error: unknown,
    logSyncWarning: AttachmentBackendDeps['logSyncWarning'],
): boolean => {
    if (!isWebdavRateLimitedError(error)) return false;
    webdavAttachmentRateLimitedUntil = Math.max(
        webdavAttachmentRateLimitedUntil,
        Date.now() + WEBDAV_ATTACHMENT_COOLDOWN_MS,
    );
    logSyncWarning('WebDAV rate limited; pausing attachment sync', error);
    return true;
};

const getWebdavDownloadBackoff = (attachmentId: string): number | null => {
    return webdavDownloadBackoff.getBlockedUntil(attachmentId);
};

const setWebdavDownloadBackoff = (attachmentId: string, error: unknown): void => {
    webdavDownloadBackoff.setFromError(attachmentId, error);
};

const pruneWebdavDownloadBackoff = (): void => {
    webdavDownloadBackoff.prune();
};

type CloudKitOwnedAttachment = {
    ownerType: 'task' | 'project';
    ownerId: string;
    attachment: Attachment;
};

const collectCloudKitOwnedAttachments = (appData: AppData): CloudKitOwnedAttachment[] => {
    const owned: CloudKitOwnedAttachment[] = [];
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

const buildCloudKitAttachmentMetadata = (owned: CloudKitOwnedAttachment, size?: number): CloudKitAttachmentMetadata => {
    const { attachment } = owned;
    return {
        attachmentId: attachment.id,
        ownerType: owned.ownerType,
        ownerId: owned.ownerId,
        title: attachment.title || 'attachment',
        mimeType: attachment.mimeType,
        size: Number.isFinite(size ?? NaN) ? size : attachment.size,
        fileHash: attachment.fileHash,
        updatedAt: attachment.updatedAt || new Date().toISOString(),
        deletedAt: attachment.deletedAt,
    };
};

const applyCloudKitAttachmentMetadata = (
    attachment: Attachment,
    metadata: CloudKitAttachmentMetadata,
    fallbackSize?: number,
): boolean => {
    let mutated = false;
    const nextSize = Number.isFinite(metadata.size ?? NaN) ? metadata.size : fallbackSize;
    if (Number.isFinite(nextSize ?? NaN) && attachment.size !== nextSize) {
        attachment.size = nextSize;
        mutated = true;
    }
    if (metadata.fileHash && attachment.fileHash !== metadata.fileHash) {
        attachment.fileHash = metadata.fileHash;
        mutated = true;
    }
    return mutated;
};

const flushPendingCloudKitAttachmentDeletes = async (appData: AppData): Promise<boolean> => {
    const attachmentSettings = appData.settings.attachments;
    const pendingDeletes = attachmentSettings?.pendingRemoteDeletes ?? [];
    if (!attachmentSettings || pendingDeletes.length === 0) return false;

    const remaining = [];
    const recordNames: string[] = [];
    for (const pending of pendingDeletes) {
        const recordName = parseCloudKitAttachmentKey(pending.cloudKey);
        if (recordName) {
            recordNames.push(recordName);
        } else {
            remaining.push(pending);
        }
    }
    if (recordNames.length === 0) return false;

    await deleteCloudKitAttachmentAssets(recordNames);
    attachmentSettings.pendingRemoteDeletes = remaining;
    return true;
};

export async function syncWebdavAttachments(
    appData: AppData,
    webDavConfig: WebDavConfig,
    baseSyncUrl: string,
    deps: AttachmentBackendDeps,
    helpers?: SyncRunAttachmentHelpers,
): Promise<AppData | null> {
    if (!deps.isTauriRuntimeEnv()) return null;
    if (!webDavConfig.url) return null;
    const cooldownRemainingMs = getWebdavAttachmentRateLimitRemainingMs();
    if (cooldownRemainingMs > 0) {
        deps.logSyncInfo('WebDAV attachment sync skipped during rate-limit cooldown', {
            remainingMs: String(Math.ceil(cooldownRemainingMs)),
        });
        return null;
    }

    const fetcher = await deps.getTauriFetch();
    const { BaseDirectory, exists, mkdir, readFile, stat, writeFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    const { dataDir, join } = await import('@tauri-apps/api/path');
    const password = await deps.resolveWebdavPassword(webDavConfig);

    const attachmentsDirUrl = `${baseSyncUrl}/${ATTACHMENTS_DIR_NAME}`;
    try {
        await webdavMakeDirectory(attachmentsDirUrl, {
            allowInsecureHttp: webDavConfig.allowInsecureHttp,
            username: webDavConfig.username,
            password,
            fetcher,
        });
    } catch (error) {
        if (markWebdavAttachmentRateLimited(error, deps.logSyncWarning)) {
            return null;
        }
        deps.logSyncWarning('Failed to ensure WebDAV attachments directory', error);
    }

    try {
        await mkdir(await getManagedPath(ATTACHMENTS_DIR_NAME), { recursive: true });
    } catch (error) {
        deps.logSyncWarning('Failed to ensure local attachments directory', error);
    }

    const baseDataDir = await dataDir();
    const managedAttachmentsDir = await getManagedPath(ATTACHMENTS_DIR_NAME);
    const workingData = structuredClone(appData);
    const attachmentsById = collectAttachmentsById(workingData);

    pruneWebdavDownloadBackoff();
    deps.logSyncInfo('WebDAV attachment sync start', {
        count: String(attachmentsById.size),
    });

    let lastRequestAt = 0;
    const waitForSlot = async (): Promise<void> => {
        const cooldownRemainingMs = getWebdavAttachmentRateLimitRemainingMs();
        if (cooldownRemainingMs > 0) {
            throw new Error(`WebDAV rate limited for ${cooldownRemainingMs}ms`);
        }
        const now = Date.now();
        const elapsed = now - lastRequestAt;
        if (elapsed < WEBDAV_ATTACHMENT_MIN_INTERVAL_MS) {
            await sleep(WEBDAV_ATTACHMENT_MIN_INTERVAL_MS - elapsed);
        }
        lastRequestAt = Date.now();
    };
    const handleRateLimit = (error: unknown): boolean => {
        return markWebdavAttachmentRateLimited(error, deps.logSyncWarning);
    };

    const { readLocalFile, localFileExists, statLocalFile } = createLocalAttachmentFs(deps.logSyncWarning, {
        baseDataDir,
        dataBaseDir: BaseDirectory.Data,
        exists,
        readFile,
        managedAttachmentsDir,
        stat,
    });
    const computeLocalFileHash = async (path: string, attachment: Attachment): Promise<string | null> =>
        computeSha256Hex(await readLocalFile(path, attachment));

    let abortedByRateLimit = false;

    // WebDAV alone verifies que an already-uploaded attachment's remote copy es todavía ahí —
    // si it was deleted directly on la server, clear cloudKey por lo que la lifecycle below re-uploads
    // it. esto has to ejecución as its own pass antes de la lifecycle: it's an asincrónico, network-calling,
    // estado-mutating verificar, que doesn't fit la lifecycle's synchronous `hasCloudCopy` predicate.
    let preMutated = false;
    const maybeYieldPrePass = createCooperativeYield(4);
    for (const attachment of attachmentsById.values()) {
        await maybeYieldPrePass();
        if (attachment.kind !== 'file' || attachment.deletedAt || abortedByRateLimit) continue;

        const rawUri = attachment.uri ? stripFileScheme(attachment.uri) : '';
        const isHttp = /^https?:\/\//i.test(rawUri);
        const localPath = isHttp ? '' : rawUri;
        const hasLocalPath = Boolean(localPath);
        const existsLocally = hasLocalPath
            ? await localFileExists(localPath, attachment)
            : false;
        deps.logSyncInfo('WebDAV attachment check', {
            id: attachment.id,
            title: attachment.title || 'attachment',
            uri: localPath || rawUri,
            cloud: attachment.cloudKey ? 'set' : 'missing',
            local: hasLocalPath ? 'true' : 'false',
            exists: existsLocally ? 'true' : 'false',
        });

        if (existsLocally) {
            webdavDownloadBackoff.deleteEntry(attachment.id);
        }

        if (attachment.cloudKey && existsLocally) {
            try {
                const remoteExists = await withRetry(async () => {
                    await waitForSlot();
                    return await webdavFileExists(`${baseSyncUrl}/${attachment.cloudKey}`, {
                        allowInsecureHttp: webDavConfig.allowInsecureHttp,
                        username: webDavConfig.username,
                        password,
                        fetcher,
                    });
                }, WEBDAV_ATTACHMENT_RETRY_OPTIONS);
                deps.logSyncInfo('WebDAV attachment remote exists', {
                    id: attachment.id,
                    exists: remoteExists ? 'true' : 'false',
                });
                if (!remoteExists) {
                    attachment.cloudKey = undefined;
                    preMutated = true;
                }
            } catch (error) {
                if (handleRateLimit(error)) {
                    abortedByRateLimit = true;
                    break;
                }
                deps.logSyncWarning('Failed to check WebDAV attachment remote status', error);
            }
        }
    }

    // limitación policy: per-run upload/download caps, plus la mismo rate-limit abort la pre-pass
    // above already tripped. Passed to la shared lifecycle as optional `policy` hooks (default
    // off for cada otro backend) por lo que la caps/backoff live in one place otro backends puede reuse.
    let uploadCount = 0;
    let uploadLimitLogged = false;
    let downloadCount = 0;
    let downloadLimitLogged = false;

    const shouldUpload = (): boolean => {
        if (uploadCount >= WEBDAV_ATTACHMENT_MAX_UPLOADS_PER_SYNC) {
            if (!uploadLimitLogged) {
                deps.logSyncInfo('WebDAV attachment upload limit reached', {
                    limit: String(WEBDAV_ATTACHMENT_MAX_UPLOADS_PER_SYNC),
                });
                uploadLimitLogged = true;
            }
            return false;
        }
        uploadCount += 1;
        return true;
    };

    const shouldDownload = (attachment: Attachment): boolean => {
        if (getWebdavDownloadBackoff(attachment.id)) return false;
        if (downloadCount >= WEBDAV_ATTACHMENT_MAX_DOWNLOADS_PER_SYNC) {
            if (!downloadLimitLogged) {
                deps.logSyncInfo('WebDAV attachment download limit reached', {
                    limit: String(WEBDAV_ATTACHMENT_MAX_DOWNLOADS_PER_SYNC),
                });
                downloadLimitLogged = true;
            }
            return false;
        }
        downloadCount += 1;
        return true;
    };

    const syncMutated = await syncBasicRemoteAttachments({
        attachmentsById,
        forceUploadExistingLocal: helpers?.activationProbe === true,
        ensureLocalSnapshotFresh: helpers?.ensureLocalSnapshotFresh,
        localFileExists,
        getLocalFileStat: statLocalFile,
        computeLocalFileHash,
        contentChangePhase: helpers?.phase,
        policy: {
            shouldSkip: () => abortedByRateLimit,
            shouldUpload,
            shouldDownload,
        },
        onUpload: async (attachment, localPath) => {
            const cloudKey = buildCloudKey(attachment);
            const fileData = await readLocalFile(localPath, attachment);
            const validation = await validateAttachmentForUpload(attachment, fileData.length);
            if (!validation.valid) {
                const failure = handleAttachmentValidationFailure(attachment, validation.error);
                reportProgress(
                    attachment.id,
                    'upload',
                    0,
                    attachment.size ?? fileData.length,
                    'failed',
                    failure.message,
                );
                deps.logSyncWarning(
                    failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message,
                );
                return failure.mutated;
            }
            clearAttachmentValidationFailure(attachment.id);
            reportProgress(attachment.id, 'upload', 0, fileData.length, 'active');
            deps.logSyncInfo('WebDAV attachment upload start', {
                id: attachment.id,
                bytes: String(fileData.length),
                cloudKey,
            });
            // Encrypted bytes mantener la attachment's exact remote name (cloudKey es identity-
            // keyed y immutable once uploaded), but they are longer que la plaintext — the
            // Content-Length header has to describe what actually goes on la wire.
            const wireData = await sealAttachmentBytes(fileData);
            await withRetry(
                async () => {
                    await waitForSlot();
                    return await webdavPutFile(
                        `${baseSyncUrl}/${cloudKey}`,
                        wireData,
                        attachment.mimeType || 'application/octet-stream',
                        {
                            allowInsecureHttp: webDavConfig.allowInsecureHttp,
                            headers: { 'Content-Length': String(wireData.length) },
                            username: webDavConfig.username,
                            password,
                            fetcher,
                            timeoutMs: UPLOAD_TIMEOUT_MS,
                        },
                    );
                },
                {
                    ...WEBDAV_ATTACHMENT_RETRY_OPTIONS,
                    onRetry: (error, attempt, delayMs) => {
                        deps.logSyncInfo('Retrying WebDAV attachment upload', {
                            id: attachment.id,
                            attempt: String(attempt + 1),
                            delayMs: String(delayMs),
                            error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
                        });
                    },
                },
            );
            attachment.cloudKey = cloudKey;
            attachment.localStatus = 'available';
            reportProgress(attachment.id, 'upload', fileData.length, fileData.length, 'completed');
            deps.logSyncInfo('WebDAV attachment upload done', {
                id: attachment.id,
                bytes: String(fileData.length),
            });
            return true;
        },
        onUploadError: (attachment, error) => {
            if (handleRateLimit(error)) {
                abortedByRateLimit = true;
                return;
            }
            reportProgress(
                attachment.id,
                'upload',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to upload attachment ${attachment.title}`, error);
        },
        onDownload: async (attachment) => {
            if (!attachment.cloudKey) return false;
            const cloudKey = attachment.cloudKey;
            let fileData: ArrayBuffer;
            try {
                fileData = await withRetry(async () => {
                    await waitForSlot();
                    return await webdavGetFile(`${baseSyncUrl}/${cloudKey}`, {
                        allowInsecureHttp: webDavConfig.allowInsecureHttp,
                        username: webDavConfig.username,
                        password,
                        fetcher,
                        onProgress: (loaded, total) =>
                            reportProgress(attachment.id, 'download', loaded, total, 'active'),
                    });
                }, WEBDAV_ATTACHMENT_RETRY_OPTIONS);
            } catch (error) {
                if (handleRateLimit(error)) {
                    abortedByRateLimit = true;
                    return false;
                }
                if (getErrorStatus(error) === 404) {
                    webdavDownloadBackoff.deleteEntry(attachment.id);
                    const mutated = markAttachmentUnrecoverable(attachment);
                    deps.logSyncInfo('Cleared missing WebDAV cloud key after 404', { id: attachment.id });
                    return mutated;
                }
                throw error;
            }
            // Decrypt antes de la hash verificar: fileHash es a plaintext-domain value inside the
            // synced document, y it debe stay estable across re-encryptions.
            const bytes = await openAttachmentBytes(
                fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData as ArrayBuffer),
            );
            await validateAttachmentHash(attachment, bytes);
            const filename = cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.uri)}`;
            const targetPath = await join(managedAttachmentsDir, filename);
            await writeFileSafelyAbsolute(targetPath, bytes, {
                writeFile,
                rename,
                remove,
            });
            attachment.uri = targetPath;
            const statusChanged = attachment.localStatus !== 'available';
            if (statusChanged) {
                attachment.localStatus = 'available';
            }
            webdavDownloadBackoff.deleteEntry(attachment.id);
            reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
            return statusChanged;
        },
        onDownloadError: (attachment, error) => {
            // Rate-limit y 404 are handled inside onDownload's own try/capturar above, desde only
            // onDownload's valor devuelto puede signal a mutación back to la lifecycle. Only "other"
            // (reintentar-exhausted / hash-validation / write) errors reach here.
            setWebdavDownloadBackoff(attachment.id, error);
            reportProgress(
                attachment.id,
                'download',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to download attachment ${attachment.title}`, error);
        },
    });

    const didMutate = preMutated || syncMutated;

    if (abortedByRateLimit) {
        deps.logSyncWarning('WebDAV attachment sync aborted due to rate limiting');
    }
    deps.logSyncInfo('WebDAV attachment sync done', {
        mutated: didMutate ? 'true' : 'false',
    });
    return didMutate ? workingData : null;
}

export async function syncCloudAttachments(
    appData: AppData,
    cloudConfig: CloudConfig,
    baseSyncUrl: string,
    deps: AttachmentBackendDeps,
    helpers?: SyncRunAttachmentHelpers,
): Promise<boolean> {
    if (!deps.isTauriRuntimeEnv() || !cloudConfig.url) return false;

    const fetcher = await deps.getTauriFetch();
    const { BaseDirectory, exists, mkdir, readFile, stat, writeFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    const { dataDir, join } = await import('@tauri-apps/api/path');

    try {
        await mkdir(await getManagedPath(ATTACHMENTS_DIR_NAME), { recursive: true });
    } catch (error) {
        deps.logSyncWarning('Failed to ensure local attachments directory', error);
    }

    const baseDataDir = await dataDir();
    const managedAttachmentsDir = await getManagedPath(ATTACHMENTS_DIR_NAME);
    const attachmentsById = collectAttachmentsById(appData);

    const { readLocalFile, localFileExists, statLocalFile } = createLocalAttachmentFs(deps.logSyncWarning, {
        baseDataDir,
        dataBaseDir: BaseDirectory.Data,
        exists,
        readFile,
        managedAttachmentsDir,
        stat,
    });
    const computeLocalFileHash = async (path: string, attachment: Attachment): Promise<string | null> =>
        computeSha256Hex(await readLocalFile(path, attachment));

    return await syncBasicRemoteAttachments({
        attachmentsById,
        forceUploadExistingLocal: helpers?.activationProbe === true,
        ensureLocalSnapshotFresh: helpers?.ensureLocalSnapshotFresh,
        localFileExists,
        getLocalFileStat: statLocalFile,
        computeLocalFileHash,
        contentChangePhase: helpers?.phase,
        onUpload: async (attachment, localPath) => {
            const cloudKey = buildCloudKey(attachment);
            const fileData = await readLocalFile(localPath, attachment);
            const validation = await validateAttachmentForUpload(attachment, fileData.length);
            if (!validation.valid) {
                const failure = handleAttachmentValidationFailure(attachment, validation.error);
                reportProgress(
                    attachment.id,
                    'upload',
                    0,
                    attachment.size ?? fileData.length,
                    'failed',
                    failure.message,
                );
                deps.logSyncWarning(
                    failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message,
                );
                return failure.mutated;
            }
            clearAttachmentValidationFailure(attachment.id);
            reportProgress(attachment.id, 'upload', 0, fileData.length, 'active');
            await withRetry(
                () =>
                    cloudPutFile(
                        `${baseSyncUrl}/${cloudKey}`,
                        fileData,
                        attachment.mimeType || 'application/octet-stream',
                        {
                            allowInsecureHttp: cloudConfig.allowInsecureHttp,
                            token: cloudConfig.token,
                            fetcher,
                            timeoutMs: UPLOAD_TIMEOUT_MS,
                            onProgress: (loaded, total) =>
                                reportProgress(attachment.id, 'upload', loaded, total, 'active'),
                        },
                    ),
                {
                    ...CLOUD_ATTACHMENT_RETRY_OPTIONS,
                    onRetry: (error, attempt, delayMs) => {
                        deps.logSyncInfo('Retrying cloud attachment upload', {
                            id: attachment.id,
                            attempt: String(attempt + 1),
                            delayMs: String(delayMs),
                            error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
                        });
                    },
                },
            );
            attachment.cloudKey = cloudKey;
            attachment.localStatus = 'available';
            reportProgress(attachment.id, 'upload', fileData.length, fileData.length, 'completed');
            return true;
        },
        onUploadError: (attachment, error) => {
            reportProgress(
                attachment.id,
                'upload',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to upload attachment ${attachment.title}`, error);
        },
        onDownload: async (attachment) => {
            if (!attachment.cloudKey) return false;
            let fileData: ArrayBuffer;
            try {
                fileData = await withRetry(() =>
                    cloudGetFile(`${baseSyncUrl}/${attachment.cloudKey}`, {
                        allowInsecureHttp: cloudConfig.allowInsecureHttp,
                        token: cloudConfig.token,
                        fetcher,
                        onProgress: (loaded, total) =>
                            reportProgress(attachment.id, 'download', loaded, total, 'active'),
                    }),
                );
            } catch (error) {
                if (getErrorStatus(error) === 404) {
                    return markAttachmentUnrecoverable(attachment);
                }
                throw error;
            }
            const bytes =
                fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData as ArrayBuffer);
            await validateAttachmentHash(attachment, bytes);
            const filename =
                attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.uri)}`;
            const targetPath = await join(managedAttachmentsDir, filename);
            await writeFileSafelyAbsolute(targetPath, bytes, {
                writeFile,
                rename,
                remove,
            });
            attachment.uri = targetPath;
            const statusChanged = attachment.localStatus !== 'available';
            if (statusChanged) {
                attachment.localStatus = 'available';
            }
            reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
            return statusChanged;
        },
        onDownloadError: (attachment, error) => {
            reportProgress(
                attachment.id,
                'download',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to download attachment ${attachment.title}`, error);
        },
    });
}

export async function syncDropboxAttachments(
    appData: AppData,
    resolveAccessToken: (forceRefresh?: boolean) => Promise<string>,
    deps: AttachmentBackendDeps,
    helpers?: SyncRunAttachmentHelpers,
): Promise<boolean> {
    if (!deps.isTauriRuntimeEnv()) return false;

    const fetcher = await deps.getTauriFetch();
    const dropboxFetcher = fetcher ?? fetch;
    const { BaseDirectory, exists, mkdir, readFile, stat, writeFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    const { dataDir, join } = await import('@tauri-apps/api/path');

    try {
        await mkdir(await getManagedPath(ATTACHMENTS_DIR_NAME), { recursive: true });
    } catch (error) {
        deps.logSyncWarning('Failed to ensure local attachments directory', error);
    }

    const baseDataDir = await dataDir();
    const managedAttachmentsDir = await getManagedPath(ATTACHMENTS_DIR_NAME);
    const attachmentsById = collectAttachmentsById(appData);

    const withDropboxAccess = async <T>(operation: (accessToken: string) => Promise<T>): Promise<T> => {
        try {
            return await operation(await resolveAccessToken(false));
        } catch (error) {
            if (error instanceof DropboxUnauthorizedError) {
                return await operation(await resolveAccessToken(true));
            }
            throw error;
        }
    };

    const { readLocalFile, localFileExists, statLocalFile } = createLocalAttachmentFs(deps.logSyncWarning, {
        baseDataDir,
        dataBaseDir: BaseDirectory.Data,
        exists,
        readFile,
        managedAttachmentsDir,
        stat,
    });
    const computeLocalFileHash = async (path: string, attachment: Attachment): Promise<string | null> =>
        computeSha256Hex(await readLocalFile(path, attachment));

    return await syncBasicRemoteAttachments({
        attachmentsById,
        forceUploadExistingLocal: helpers?.activationProbe === true,
        ensureLocalSnapshotFresh: helpers?.ensureLocalSnapshotFresh,
        localFileExists,
        getLocalFileStat: statLocalFile,
        computeLocalFileHash,
        contentChangePhase: helpers?.phase,
        onUpload: async (attachment, localPath) => {
            const cloudKey = buildCloudKey(attachment);
            const fileData = await readLocalFile(localPath, attachment);
            const validation = await validateAttachmentForUpload(attachment, fileData.length);
            if (!validation.valid) {
                const failure = handleAttachmentValidationFailure(attachment, validation.error);
                reportProgress(
                    attachment.id,
                    'upload',
                    0,
                    attachment.size ?? fileData.length,
                    'failed',
                    failure.message,
                );
                deps.logSyncWarning(
                    failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message,
                );
                return failure.mutated;
            }
            clearAttachmentValidationFailure(attachment.id);
            reportProgress(attachment.id, 'upload', 0, fileData.length, 'active');
            const wireData = await sealAttachmentBytes(fileData);
            await withRetry(
                () =>
                    withDropboxAccess((token) =>
                        uploadDropboxFile(
                            token,
                            cloudKey,
                            wireData,
                            attachment.mimeType || 'application/octet-stream',
                            dropboxFetcher,
                        ),
                    ),
                {
                    ...CLOUD_ATTACHMENT_RETRY_OPTIONS,
                    onRetry: (error, attempt, delayMs) => {
                        deps.logSyncInfo('Retrying Dropbox attachment upload', {
                            id: attachment.id,
                            attempt: String(attempt + 1),
                            delayMs: String(delayMs),
                            error: sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
                        });
                    },
                },
            );
            attachment.cloudKey = cloudKey;
            attachment.localStatus = 'available';
            reportProgress(attachment.id, 'upload', fileData.length, fileData.length, 'completed');
            return true;
        },
        onUploadError: (attachment, error) => {
            reportProgress(
                attachment.id,
                'upload',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to upload attachment ${attachment.title}`, error);
        },
        onDownload: async (attachment) => {
            if (!attachment.cloudKey) return false;
            reportProgress(attachment.id, 'download', 0, attachment.size ?? 0, 'active');
            let fileData: ArrayBuffer;
            try {
                fileData = await withRetry(() =>
                    withDropboxAccess((token) => downloadDropboxFile(token, attachment.cloudKey!, dropboxFetcher)),
                );
            } catch (error) {
                if (error instanceof DropboxFileNotFoundError) {
                    return markAttachmentUnrecoverable(attachment);
                }
                throw error;
            }
            const bytes = await openAttachmentBytes(
                fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : new Uint8Array(fileData as ArrayBuffer),
            );
            await validateAttachmentHash(attachment, bytes);
            const filename =
                attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.uri)}`;
            const targetPath = await join(managedAttachmentsDir, filename);
            await writeFileSafelyAbsolute(targetPath, bytes, {
                writeFile,
                rename,
                remove,
            });
            attachment.uri = targetPath;
            const statusChanged = attachment.localStatus !== 'available';
            if (statusChanged) {
                attachment.localStatus = 'available';
            }
            reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
            return statusChanged;
        },
        onDownloadError: (attachment, error) => {
            reportProgress(
                attachment.id,
                'download',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to download attachment ${attachment.title}`, error);
        },
    });
}

export async function syncCloudKitAttachments(
    appData: AppData,
    deps: AttachmentBackendDeps,
    helpers?: SyncRunAttachmentHelpers,
): Promise<boolean> {
    if (!deps.isTauriRuntimeEnv()) return false;

    const { BaseDirectory, exists, mkdir, readFile, stat } = await import('@tauri-apps/plugin-fs');
    const { dataDir, join } = await import('@tauri-apps/api/path');

    try {
        await mkdir(await getManagedPath(ATTACHMENTS_DIR_NAME), { recursive: true });
    } catch (error) {
        deps.logSyncWarning('Failed to ensure CloudKit attachments directory', error);
    }

    const baseDataDir = await dataDir();
    const managedAttachmentsDir = await getManagedPath(ATTACHMENTS_DIR_NAME);
    const attachmentsById = collectAttachmentsById(appData);
    // Same tarea/project walk as `attachmentsById`, kept as its own owner-tagged list because
    // CloudKit's upload metadata needs la owning tarea/project id, que la shared lifecycle's
    // per-attachment callbacks no carry.
    const ownedByAttachmentId = new Map(
        collectCloudKitOwnedAttachments(appData).map((owned) => [owned.attachment.id, owned]),
    );
    const flushMutated = await flushPendingCloudKitAttachmentDeletes(appData);

    const { readLocalFile, localFileExists, statLocalFile } = createLocalAttachmentFs(
        deps.logSyncWarning,
        { baseDataDir, dataBaseDir: BaseDirectory.Data, exists, readFile, managedAttachmentsDir, stat },
        'Failed to check CloudKit attachment file',
    );
    const computeLocalFileHash = async (path: string, attachment: Attachment): Promise<string | null> =>
        computeSha256Hex(await readLocalFile(path, attachment));

    deps.logSyncInfo('CloudKit attachment sync start', {
        count: String(attachmentsById.size),
    });

    const syncMutated = await syncBasicRemoteAttachments({
        attachmentsById,
        forceUploadExistingLocal: helpers?.activationProbe === true,
        ensureLocalSnapshotFresh: helpers?.ensureLocalSnapshotFresh,
        localFileExists,
        getLocalFileStat: statLocalFile,
        computeLocalFileHash,
        contentChangePhase: helpers?.phase,
        // A cloudKey written by a different backend antes de a proveedor switch isn't a valid
        // CloudKit record key, por lo que CloudKit debe todavía treat la attachment as needing upload.
        hasCloudCopy: (attachment) => Boolean(parseCloudKitAttachmentKey(attachment.cloudKey)),
        onUpload: async (attachment, localPath) => {
            const owned = ownedByAttachmentId.get(attachment.id);
            if (!owned) return false;
            const fileData = await readLocalFile(localPath, attachment);
            const validation = await validateAttachmentForUpload(attachment, fileData.length);
            if (!validation.valid) {
                const failure = handleAttachmentValidationFailure(attachment, validation.error);
                reportProgress(
                    attachment.id,
                    'upload',
                    0,
                    attachment.size ?? fileData.length,
                    'failed',
                    failure.message,
                );
                deps.logSyncWarning(failure.message, validation.error);
                return failure.mutated;
            }

            clearAttachmentValidationFailure(attachment.id);
            reportProgress(attachment.id, 'upload', 0, fileData.length, 'active');
            const metadata = buildCloudKitAttachmentMetadata(owned, fileData.length);
            const savedMetadata = await saveCloudKitAttachmentAsset(attachment.id, localPath, metadata);
            attachment.cloudKey = buildCloudKitAttachmentKey(attachment.id);
            attachment.localStatus = 'available';
            applyCloudKitAttachmentMetadata(attachment, savedMetadata, fileData.length);
            reportProgress(attachment.id, 'upload', fileData.length, fileData.length, 'completed');
            return true;
        },
        onUploadError: (attachment, error) => {
            reportProgress(
                attachment.id,
                'upload',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to upload CloudKit attachment ${attachment.title}`, error);
        },
        onDownload: async (attachment) => {
            const recordName = parseCloudKitAttachmentKey(attachment.cloudKey);
            if (!recordName) return false;
            const extension = extractExtension(attachment.title) || extractExtension(attachment.uri);
            const filename = `${attachment.id}${extension}`;
            const targetPath = await join(managedAttachmentsDir, filename);
            reportProgress(attachment.id, 'download', 0, attachment.size ?? 0, 'active');
            const metadata = await fetchCloudKitAttachmentAsset(recordName, targetPath);
            const bytes = await readFile(targetPath);
            await validateAttachmentHash(attachment, bytes);
            attachment.uri = targetPath;
            attachment.localStatus = 'available';
            applyCloudKitAttachmentMetadata(attachment, metadata, bytes.length);
            reportProgress(attachment.id, 'download', bytes.length, bytes.length, 'completed');
            return true;
        },
        onDownloadError: (attachment, error) => {
            reportProgress(
                attachment.id,
                'download',
                0,
                attachment.size ?? 0,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
            deps.logSyncWarning(`Failed to download CloudKit attachment ${attachment.title}`, error);
        },
    });

    const didMutate = flushMutated || syncMutated;
    deps.logSyncInfo('CloudKit attachment sync done', {
        mutated: didMutate ? 'true' : 'false',
    });

    return didMutate;
}

export async function syncFileAttachments(
    appData: AppData,
    baseSyncDir: string,
    deps: AttachmentBackendDeps,
    helpers?: SyncRunAttachmentHelpers,
): Promise<boolean> {
    if (!deps.isTauriRuntimeEnv() || !baseSyncDir) return false;

    // #1037: cada fs llamar below puede land on la sync folder, que puede be a
    // slow montar, por lo que la ones la plugin runs on la main thread come from
    // ./sync-fs instead. The plugin's own readFile/writeFile are already asincrónico.
    const { BaseDirectory, exists, readFile, stat, writeFile } = await import('@tauri-apps/plugin-fs');
    const { dataDir, join } = await import('@tauri-apps/api/path');

    const attachmentsDir = await join(baseSyncDir, ATTACHMENTS_DIR_NAME);
    try {
        await syncFsMkdir(attachmentsDir);
    } catch (error) {
        deps.logSyncWarning('Failed to ensure sync attachments directory', error);
    }

    try {
        await syncFsMkdir(await getManagedPath(ATTACHMENTS_DIR_NAME));
    } catch (error) {
        deps.logSyncWarning('Failed to ensure local attachments directory', error);
    }

    const baseDataDir = await dataDir();
    const managedAttachmentsDir = await getManagedPath(ATTACHMENTS_DIR_NAME);
    const attachmentsById = collectAttachmentsById(appData);

    const { readLocalFile, localFileExists, statLocalFile } = createLocalAttachmentFs(deps.logSyncWarning, {
        baseDataDir,
        dataBaseDir: BaseDirectory.Data,
        // An absolute attachment uri puede point at la slow montar too; solo the
        // base-directory-relative rama es guaranteed to be local app data.
        exists: (path, options) => (options ? exists(path, options) : syncFsExists(path)),
        readFile,
        managedAttachmentsDir,
        // Same #1037 risk as `exists` above — la fs plugin's `stat` es main-thread
        // too (review S5), por lo que a non-managed-dir ruta goes a través de la asincrónico Rust
        // command instead.
        stat: async (path, options) => {
            if (options) return stat(path, options);
            const result = await syncFsStat(path);
            return { mtime: new Date(result.mtimeMs), size: result.size };
        },
    });
    const computeLocalFileHash = async (path: string, attachment: Attachment): Promise<string | null> =>
        computeSha256Hex(await readLocalFile(path, attachment));

    // Mirror la WebDAV presence pre-pass: a cloudKey recorded against a
    // previous sync folder (or a archivo deleted desde esto one) no debe stop
    // la copy en la current folder. Clearing it lets la lifecycle below
    // re-upload; solo cleared cuando a local copy exists to upload desde (#1001).
    let preMutated = false;
    for (const attachment of attachmentsById.values()) {
        if (attachment.kind !== 'file' || attachment.deletedAt || !attachment.cloudKey) continue;
        const rawUri = attachment.uri ? stripFileScheme(attachment.uri) : '';
        if (!rawUri || /^https?:\/\//i.test(rawUri)) continue;
        if (!(await localFileExists(rawUri, attachment))) continue;
        try {
            const remotePath = await resolveFileBackendPath(join, baseSyncDir, attachment.cloudKey);
            if (!(await syncFsExists(remotePath))) {
                attachment.cloudKey = undefined;
                preMutated = true;
            }
        } catch (error) {
            deps.logSyncWarning('Failed to check sync-folder attachment presence', error);
        }
    }

    const syncMutated = await syncBasicRemoteAttachments({
        attachmentsById,
        forceUploadExistingLocal: helpers?.activationProbe === true,
        ensureLocalSnapshotFresh: helpers?.ensureLocalSnapshotFresh,
        localFileExists,
        getLocalFileStat: statLocalFile,
        computeLocalFileHash,
        contentChangePhase: helpers?.phase,
        onUpload: async (attachment, localPath) => {
            const cloudKey = buildCloudKey(attachment);
            const fileData = await readLocalFile(localPath, attachment);
            const validation = await validateAttachmentForUpload(
                attachment,
                fileData.length,
                FILE_BACKEND_VALIDATION_CONFIG,
            );
            if (!validation.valid) {
                const failure = handleAttachmentValidationFailure(attachment, validation.error);
                deps.logSyncWarning(
                    failure.reachedLimit ? `${failure.message}; marking attachment unrecoverable` : failure.message,
                );
                return failure.mutated;
            }
            clearAttachmentValidationFailure(attachment.id);
            // The sync folder es la remote for esto backend, por lo que its attachment bytes are
            // encrypted here for la mismo reason WebDAV's y Dropbox's are. The local managed
            // copy (below, in onDownload) stays plaintext — encryption nunca touches local data.
            const wireData = await sealAttachmentBytes(fileData);
            await writeFileSafelyAbsolute(await resolveFileBackendPath(join, baseSyncDir, cloudKey), wireData, {
                writeFile,
                rename: syncFsRename,
                remove: syncFsRemove,
            });
            attachment.cloudKey = cloudKey;
            attachment.localStatus = 'available';
            return true;
        },
        onUploadError: (attachment, error) => {
            deps.logSyncWarning(`Failed to copy attachment ${attachment.title} to sync folder`, error);
        },
        onDownload: async (attachment) => {
            if (!attachment.cloudKey) return false;
            const sourcePath = await resolveFileBackendPath(join, baseSyncDir, attachment.cloudKey);
            if (!(await syncFsExists(sourcePath))) return false;
            const fileData = await openAttachmentBytes(await readFile(sourcePath));
            await validateAttachmentHash(attachment, fileData);
            const filename =
                attachment.cloudKey.split('/').pop() || `${attachment.id}${extractExtension(attachment.uri)}`;
            const targetPath = await join(managedAttachmentsDir, filename);
            await writeFileSafelyAbsolute(targetPath, fileData, {
                writeFile,
                rename: syncFsRename,
                remove: syncFsRemove,
            });
            attachment.uri = targetPath;
            const statusChanged = attachment.localStatus !== 'available';
            if (statusChanged) {
                attachment.localStatus = 'available';
            }
            return statusChanged;
        },
        onDownloadError: (attachment, error) => {
            deps.logSyncWarning(`Failed to copy attachment ${attachment.title} from sync folder`, error);
        },
    });
    return preMutated || syncMutated;
}
