import {
    applyAttachmentContentStat,
    bumpAttachmentContentRevision,
    checkAttachmentContentChange,
    type LocalFileStat,
} from './attachment-change-detection';
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
    /**
     * Check-on-touch content-change detection (#1057). Both optional; omitting either
     * (the default) preserves today's behaviour exactly — an attachment with a cloud
     * copy that's already present locally is left alone, same as before this feature.
     * Supplying both turns on, for every attachment that already `hasCloudCopy` and
     * exists locally, the cheap mtime/size compare against the attachment's recorded
     * `contentMtimeMs`/`contentSize`, hash-confirmed via `computeLocalFileHash` before
     * anything is treated as a real change.
     */
    getLocalFileStat?: (path: string, attachment: Attachment) => Promise<LocalFileStat | null>;
    /** Only invoked when the cheap stat compare already mismatched. */
    computeLocalFileHash?: (path: string, attachment: Attachment) => Promise<string | null>;
    /**
     * Which half of the sync cycle this call represents (see sync-run.ts's
     * `SyncRunAttachmentPhase`). Meaningless without `getLocalFileStat`. A confirmed
     * content change is only ever this device's own edit during 'prepare' (it runs on
     * local data before this cycle's remote pull/merge, so there is nothing else it
     * could be) — re-upload. During 'post-merge' the same mismatch means the merge
     * just adopted another device's newer content and this device's on-disk copy is
     * stale — re-download instead. Getting this backwards would ping-pong the two
     * devices' uploads against each other forever.
     */
    contentChangePhase?: 'prepare' | 'post-merge';
    /**
     * Called (review S3) when a post-merge re-download was about to overwrite a local
     * file, but a stat taken immediately before the download no longer matches the
     * stat that triggered detection — evidence of a local edit landing in the window
     * between this cycle's prepare pass and this post-merge pass. The download is
     * always skipped in that case (never optional); this is purely an observability
     * hook for callers that want to log it. The skipped attachment is retried as a
     * normal local edit by the next cycle's prepare pass.
     */
    onLocalEditRace?: (attachment: Attachment) => void;
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
    const resolveLocalPath = options.resolveLocalPath ?? defaultResolveLocalPath;

    // First-transfer bookkeeping: populate contentMtimeMs/contentSize (and, on
    // upload, fileHash) from whatever's actually on disk once a transfer succeeds, so
    // the next cycle's check-on-touch compare has a baseline. Best-effort — a stat
    // failure here doesn't undo an otherwise-successful transfer.
    const refreshContentStat = async (attachment: Attachment, path: string): Promise<void> => {
        if (!options.getLocalFileStat) return;
        const stat = await options.getLocalFileStat(path, attachment).catch(() => null);
        if (stat) applyAttachmentContentStat(attachment, stat);
    };

    for (const attachment of options.attachmentsById.values()) {
        await options.beforeEachAttachment?.();
        if (attachment.kind !== 'file') continue;
        if (attachment.deletedAt) continue;
        if (options.policy?.shouldSkip?.(attachment)) continue;

        const rawUri = attachment.uri ? resolveLocalPath(attachment.uri) : '';
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
                        if (!attachment.fileHash && options.computeLocalFileHash) {
                            const hash = await options.computeLocalFileHash(localPath, attachment).catch(() => null);
                            if (hash) attachment.fileHash = hash;
                        }
                        await refreshContentStat(attachment, localPath);
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
                        // Loop safety (#1057): stat the file we just wrote and record it
                        // immediately, using the (possibly just-updated) uri — otherwise
                        // every subsequent cycle re-detects this download as a "change".
                        const freshPath = attachment.uri ? resolveLocalPath(attachment.uri) : localPath;
                        if (freshPath) await refreshContentStat(attachment, freshPath);
                    }
                } catch (error) {
                    if (options.isFatalError?.(error)) throw error;
                    options.onDownloadError(attachment, error);
                }
            }
        }

        // Check-on-touch content-change detection (#1057): an attachment that already
        // has a cloud copy AND exists locally was, until now, left untouched by this
        // loop. Only runs when the caller wired both stat/hash callbacks; otherwise
        // this is a no-op and behaviour is unchanged from before this feature.
        if (hasCloudCopy(attachment) && existsLocally && options.getLocalFileStat && options.contentChangePhase) {
            const stat = await options.getLocalFileStat(localPath, attachment).catch(() => null);
            if (stat) {
                const check = await checkAttachmentContentChange(
                    attachment,
                    stat,
                    () => (options.computeLocalFileHash ? options.computeLocalFileHash(localPath, attachment) : Promise.resolve(null)),
                );
                if (!check.changed) {
                    if (check.stat.mtimeMs !== attachment.contentMtimeMs || check.stat.size !== attachment.contentSize) {
                        applyAttachmentContentStat(attachment, check.stat, check.hash);
                        didMutate = true;
                    }
                } else if (!check.hash) {
                    // The stat mismatched but no hash could be computed to confirm it (review
                    // S2) — do nothing this cycle rather than bump/upload/download on an
                    // unconfirmed guess, which could publish a `fileHash` that describes the
                    // wrong content or overwrite a file for no real reason. Retried next cycle.
                } else if (options.contentChangePhase === 'prepare') {
                    // This device's own edit, detected before this cycle's remote pull.
                    // Review B2: attempt the re-upload FIRST — only a *confirmed success*
                    // bumps contentRev / records the new hash+stat, exactly like the
                    // first-upload path above. A failed, capped, or policy-skipped upload
                    // must leave the record untouched so the next cycle's compare still sees
                    // the mismatch and retries, instead of silently stranding the change.
                    if (!options.policy?.shouldUpload || options.policy.shouldUpload(attachment)) {
                        try {
                            if (await options.onUpload(attachment, localPath)) {
                                applyAttachmentContentStat(attachment, check.stat, check.hash);
                                attachment.contentRev = bumpAttachmentContentRevision(attachment);
                                didMutate = true;
                            }
                        } catch (error) {
                            if (options.isFatalError?.(error)) throw error;
                            options.onUploadError(attachment, error);
                        }
                    }
                } else {
                    // Post-merge: the merge just adopted another device's newer content
                    // and this device's on-disk copy is stale — re-download it.
                    if (!options.policy?.shouldDownload || options.policy.shouldDownload(attachment)) {
                        // Review S3: the local file may have been edited again in the window
                        // between this cycle's prepare pass and this post-merge pass (or the
                        // prepare pass may have missed a transient stat failure) — re-stat
                        // immediately before overwriting. A fresh mismatch here means this is
                        // actually an in-flight local edit, not remote's content; skip the
                        // download (never stomp it) and leave it for the next cycle's prepare
                        // pass to detect and re-upload properly.
                        const restat = await options.getLocalFileStat(localPath, attachment).catch(() => null);
                        const stillMatchesDetectedState = restat
                            && restat.mtimeMs === check.stat.mtimeMs
                            && restat.size === check.stat.size;
                        if (!stillMatchesDetectedState) {
                            options.onLocalEditRace?.(attachment);
                        } else {
                            try {
                                if (await options.onDownload(attachment)) {
                                    didMutate = true;
                                    const freshPath = attachment.uri ? resolveLocalPath(attachment.uri) : localPath;
                                    if (freshPath) await refreshContentStat(attachment, freshPath);
                                }
                            } catch (error) {
                                if (options.isFatalError?.(error)) throw error;
                                options.onDownloadError(attachment, error);
                            }
                        }
                    }
                }
            }
        }
    }

    return didMutate;
}
