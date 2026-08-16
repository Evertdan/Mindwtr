import { computeSha256Hex } from './attachment-hash';
import { globalProgressTracker } from './attachment-progress';
import type { AppData, Attachment, AttachmentSettings } from './types';

type PendingRemoteAttachmentDeleteEntry = NonNullable<AttachmentSettings['pendingRemoteDeletes']>[number];

export const normalizePendingRemoteDeletes = (
    value: unknown,
): PendingRemoteAttachmentDeleteEntry[] => {
    if (!Array.isArray(value)) return [];
    const deduped = new Map<string, PendingRemoteAttachmentDeleteEntry>();
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const cloudKey = typeof item.cloudKey === 'string' ? item.cloudKey.trim() : '';
        if (!cloudKey) continue;
        const next: PendingRemoteAttachmentDeleteEntry = {
            cloudKey,
            title: typeof item.title === 'string' ? item.title : undefined,
            attempts: typeof item.attempts === 'number' && Number.isFinite(item.attempts)
                ? Math.max(0, Math.floor(item.attempts))
                : 0,
            lastErrorAt: typeof item.lastErrorAt === 'string' ? item.lastErrorAt : undefined,
        };
        const existing = deduped.get(cloudKey);
        if (!existing || (next.attempts ?? 0) >= (existing.attempts ?? 0)) {
            deduped.set(cloudKey, next);
        }
    }
    return Array.from(deduped.values());
};

export const validateAttachmentHash = async (attachment: Attachment, bytes: Uint8Array): Promise<void> => {
    const expected = attachment.fileHash;
    if (!expected || expected.length !== 64) return;
    const computed = await computeSha256Hex(bytes);
    if (!computed) return;
    if (computed.toLowerCase() !== expected.toLowerCase()) {
        throw new Error('Integrity validation failed');
    }
};

export const reportProgress = (
    attachmentId: string,
    operation: 'upload' | 'download',
    loaded: number,
    total: number,
    status: 'active' | 'completed' | 'failed',
    error?: string,
) => {
    const percentage = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    globalProgressTracker.updateProgress(attachmentId, {
        operation,
        bytesTransferred: loaded,
        totalBytes: total,
        percentage,
        status,
        error,
    });
};

/**
 * Collect the live attachment objects of non-deleted tasks and projects, keyed
 * by id. The map holds the same object references that sit inside `appData` —
 * callers that mutate them (see {@link runAttachmentTransferLifecycle}) must
 * build the map from a cloned AppData.
 */
export const collectAttachmentsById = (appData: AppData): Map<string, Attachment> => {
    const attachmentsById = new Map<string, Attachment>();
    for (const task of appData.tasks) {
        if (task.deletedAt) continue;
        for (const attachment of task.attachments || []) {
            attachmentsById.set(attachment.id, attachment);
        }
    }
    for (const project of appData.projects) {
        if (project.deletedAt) continue;
        for (const attachment of project.attachments || []) {
            attachmentsById.set(attachment.id, attachment);
        }
    }
    return attachmentsById;
};

export type AttachmentTransferLifecycleOptions = {
    attachmentsById: Map<string, Attachment>;
    localFileExists: (path: string, attachment: Attachment) => Promise<boolean>;
    onUpload: (attachment: Attachment, localPath: string) => Promise<boolean>;
    onUploadError: (attachment: Attachment, error: unknown) => void;
    onDownload: (attachment: Attachment) => Promise<boolean>;
    onDownloadError: (attachment: Attachment, error: unknown) => void;
    resolveLocalPath?: (uri: string) => string;
    beforeEachAttachment?: () => Promise<void>;
    /**
     * Whether `attachment` already has a cloud copy. Defaults to `Boolean(attachment.cloudKey)`.
     * CloudKit overrides this: a `cloudKey` written by a different backend before a provider
     * switch isn't a valid CloudKit record key, so CloudKit must still treat it as needing upload.
     */
    hasCloudCopy?: (attachment: Attachment) => boolean;
    /**
     * Re-upload every locally available file even when it already has a cloud
     * key. Activation probes use this because a key issued by the previous
     * transport is not evidence that the candidate transport has the bytes.
     * The stale key is cleared before upload so a failed attempt cannot be
     * mistaken for candidate proof by the caller.
     */
    forceUploadExistingLocal?: boolean;
    /**
     * Optional throttle/backoff/cap gate. Every field is optional, and the whole object may be
     * omitted; omitting it (the default) preserves today's unthrottled behaviour, so the callers
     * that don't need it are unaffected. A backend that needs rate-limit protection (e.g. WebDAV)
     * supplies these as closures over its own counters and backoff state.
     */
    policy?: {
        /** Return true to skip `attachment` entirely this run (including its local-status
         *  refresh) — e.g. once a backend has detected it is rate-limited. */
        shouldSkip?: (attachment: Attachment) => boolean;
        /** Gate before attempting an upload, e.g. to enforce a per-run upload cap. */
        shouldUpload?: (attachment: Attachment) => boolean;
        /** Gate before attempting a download, e.g. to enforce a per-run download cap or a
         *  per-attachment backoff window. */
        shouldDownload?: (attachment: Attachment) => boolean;
    };
    /**
     * Predicate for errors that must abort the whole lifecycle run rather than being treated as
     * an isolated per-attachment failure — e.g. an AbortSignal firing mid-transfer. When it
     * matches an upload/download error, the lifecycle rethrows immediately instead of calling
     * onUploadError/onDownloadError: the promise this function returns rejects, and whichever
     * attachments were mutated by earlier, already-completed iterations this run keep their
     * mutations (the same as if the caller's own loop had thrown) — only the interrupted
     * attachment's own onUpload/onDownload side effects are the caller's to reason about.
     */
    isFatalError?: (error: unknown) => boolean;
};

const defaultResolveLocalPath = (uri: string): string => {
    if (!/^file:\/\//i.test(uri)) return uri;
    try {
        const parsed = new URL(uri);
        let path = decodeURIComponent(parsed.pathname);
        if (/^\/[A-Za-z]:\//.test(path)) {
            path = path.slice(1);
        }
        return path;
    } catch {
        return uri.replace(/^file:\/\//i, '');
    }
};

/**
 * Reconcile each file attachment's local presence with its cloud state:
 * refresh `localStatus`, upload local-only files, download cloud-only ones.
 *
 * Mutates the attachment objects in place (`localStatus`, and whatever the
 * upload/download callbacks set, e.g. `cloudKey`). Because the SQLite adapter
 * caches serialized task rows by task object identity, callers MUST pass
 * attachments collected from a cloned AppData (`cloneAppData`/`structuredClone`)
 * and persist that clone — mutating tasks already held by the store would make
 * the row cache serve stale rows and silently skip persisting these changes.
 */
export async function runAttachmentTransferLifecycle(
    options: AttachmentTransferLifecycleOptions,
): Promise<boolean> {
    let didMutate = false;
    const hasCloudCopy = options.hasCloudCopy ?? ((attachment: Attachment) => Boolean(attachment.cloudKey));

    for (const attachment of options.attachmentsById.values()) {
        await options.beforeEachAttachment?.();
        if (attachment.kind !== 'file') continue;
        if (attachment.deletedAt) continue;
        if (options.policy?.shouldSkip?.(attachment)) continue;

        const rawUri = attachment.uri ? (options.resolveLocalPath ?? defaultResolveLocalPath)(attachment.uri) : '';
        const isHttp = /^https?:\/\//i.test(rawUri);
        const localPath = isHttp ? '' : rawUri;
        const hasLocalPath = Boolean(localPath);
        const existsLocally = hasLocalPath
            ? await options.localFileExists(localPath, attachment)
            : false;

        const nextStatus: Attachment['localStatus'] = existsLocally ? 'available' : 'missing';
        if (attachment.localStatus !== nextStatus) {
            attachment.localStatus = nextStatus;
            didMutate = true;
        }

        if (options.forceUploadExistingLocal && existsLocally && attachment.cloudKey !== undefined) {
            attachment.cloudKey = undefined;
            didMutate = true;
        }

        if (!hasCloudCopy(attachment) && existsLocally) {
            if (!options.policy?.shouldUpload || options.policy.shouldUpload(attachment)) {
                try {
                    if (await options.onUpload(attachment, localPath)) {
                        didMutate = true;
                    }
                } catch (error) {
                    if (options.isFatalError?.(error)) throw error;
                    options.onUploadError(attachment, error);
                }
            }
        }

        if (hasCloudCopy(attachment) && !existsLocally) {
            if (!options.policy?.shouldDownload || options.policy.shouldDownload(attachment)) {
                try {
                    if (await options.onDownload(attachment)) {
                        didMutate = true;
                    }
                } catch (error) {
                    if (options.isFatalError?.(error)) throw error;
                    options.onDownloadError(attachment, error);
                }
            }
        }
    }

    return didMutate;
}
