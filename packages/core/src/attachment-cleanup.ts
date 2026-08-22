import type { AppData, Attachment, PendingRemoteAttachmentDelete } from './types';
import { normalizePendingRemoteDeletes } from './attachment-transfer';
import { getErrorStatus } from './sync-runtime-utils';
import { sanitizeAttachmentCloudKeyForSyncMerge } from './sync-normalization';

export const PENDING_REMOTE_ATTACHMENT_DELETE_MAX_ATTEMPTS = 12;
export const PENDING_REMOTE_ATTACHMENT_DELETE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CleanupResult {
    orphanedCount: number;
    cleanedIds: string[];
    errors: Array<{ id: string; error: string }>;
}

export function findOrphanedAttachments(appData: AppData): Attachment[] {
    const allAttachments = new Map<string, Attachment>();
    const activeReferenceIds = new Set<string>();

    for (const task of appData.tasks) {
        const taskPurged = Boolean(task.purgedAt);
        for (const attachment of task.attachments || []) {
            allAttachments.set(attachment.id, attachment);
            if (!taskPurged && !attachment.deletedAt) {
                activeReferenceIds.add(attachment.id);
            }
        }
    }

    for (const project of appData.projects) {
        const projectPurged = Boolean(project.purgedAt);
        for (const attachment of project.attachments || []) {
            allAttachments.set(attachment.id, attachment);
            if (!projectPurged && !attachment.deletedAt) {
                activeReferenceIds.add(attachment.id);
            }
        }
    }

    return Array.from(allAttachments.values()).filter((attachment) => !activeReferenceIds.has(attachment.id));
}

export function findDeletedAttachmentsForFileCleanup(appData: AppData): Attachment[] {
    const deleted = new Map<string, Attachment>();

    for (const task of appData.tasks) {
        for (const attachment of task.attachments || []) {
            if (!attachment.deletedAt) continue;
            deleted.set(attachment.id, attachment);
        }
    }

    for (const project of appData.projects) {
        for (const attachment of project.attachments || []) {
            if (!attachment.deletedAt) continue;
            deleted.set(attachment.id, attachment);
        }
    }

    return Array.from(deleted.values());
}

export type LiveAttachmentResourceReferences = {
    localUris: ReadonlySet<string>;
    cloudKeys: ReadonlySet<string>;
};

export type AttachmentCleanupRemoteTarget = {
    cloudKey: string;
    title: string;
};

export type AttachmentCleanupRemoteDelete = (
    target: AttachmentCleanupRemoteTarget,
) => Promise<void>;

export type AttachmentCleanupLifecycleOptions = {
    appData: AppData;
    deleteLocalAttachment: (attachment: Attachment) => Promise<void>;
    deleteRemoteAttachment?: AttachmentCleanupRemoteDelete;
    resolveRemoteDeleteAttachment?: () => Promise<AttachmentCleanupRemoteDelete | undefined>;
    now?: () => string;
    maxAttachmentTargets?: number;
    beforeEachAttachment?: () => void | Promise<void>;
    beforeEachRemoteDelete?: () => void | Promise<void>;
    isRemoteMissingError?: (error: unknown) => boolean;
    onRemoteAttachmentMissing?: (target: AttachmentCleanupRemoteTarget) => void;
    onRemoteDeleteError?: (target: AttachmentCleanupRemoteTarget, error: unknown) => void;
    onBatchLimitReached?: (info: { limit: number; total: number }) => void;
};

export type AttachmentCleanupLifecycleResult = {
    appData: AppData;
    orphanedAttachments: readonly Attachment[];
    processedOrphanedIds: ReadonlySet<string>;
    reachedBatchLimit: boolean;
    shouldInvalidateFastSyncState: boolean;
};

const isLocalSyncAbortError = (error: unknown): boolean => (
    error instanceof Error && error.name === 'LocalSyncAbort'
);

// Both spellings of the same file reach us: percent-encoded (file:// URIs) and
// decoded (plain paths), plus `\` separators on Windows. Collapsing them keeps a
// live reference from being missed, which would delete a file still in use.
export function normalizeAttachmentCleanupUri(uri?: string): string | undefined {
    if (!uri) return undefined;
    if (/^https?:\/\//i.test(uri) || uri.startsWith('content://')) return undefined;
    const path = uri.replace(/^file:\/\//i, '').replace(/\\/g, '/');
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

export function findLiveAttachmentResourceReferences(appData: AppData): LiveAttachmentResourceReferences {
    const localUris = new Set<string>();
    const cloudKeys = new Set<string>();

    const collect = (attachments: readonly Attachment[] | undefined, parentDeleted: boolean) => {
        if (parentDeleted) return;
        for (const attachment of attachments || []) {
            if (attachment.deletedAt) continue;
            const localUri = normalizeAttachmentCleanupUri(attachment.uri);
            if (localUri) localUris.add(localUri);
            // Lookups sanitize before comparing, so the live set must too.
            const cloudKey = sanitizeAttachmentCloudKeyForSyncMerge(attachment.cloudKey);
            if (cloudKey) cloudKeys.add(cloudKey);
        }
    };

    for (const task of appData.tasks) {
        collect(task.attachments, Boolean(task.purgedAt));
    }

    for (const project of appData.projects) {
        collect(project.attachments, Boolean(project.purgedAt));
    }

    return { localUris, cloudKeys };
}

export function isAttachmentLocalResourceReferenced(
    attachment: Attachment,
    references: LiveAttachmentResourceReferences,
): boolean {
    const localUri = normalizeAttachmentCleanupUri(attachment.uri);
    return Boolean(localUri && references.localUris.has(localUri));
}

export function isAttachmentCloudResourceReferenced(
    attachment: Pick<Attachment, 'cloudKey'>,
    references: LiveAttachmentResourceReferences,
): boolean {
    return Boolean(attachment.cloudKey && references.cloudKeys.has(attachment.cloudKey));
}

export function removeOrphanedAttachmentsFromData(appData: AppData): AppData {
    const orphanedIds = new Set(findOrphanedAttachments(appData).map((attachment) => attachment.id));

    if (orphanedIds.size === 0) return appData;

    return {
        ...appData,
        tasks: appData.tasks.map((task) => ({
            ...task,
            attachments: task.attachments?.filter((attachment) => !orphanedIds.has(attachment.id)),
        })),
        projects: appData.projects.map((project) => ({
            ...project,
            attachments: project.attachments?.filter((attachment) => !orphanedIds.has(attachment.id)),
        })),
    };
}

export function removeAttachmentsByIdFromData(appData: AppData, attachmentIds: Iterable<string>): AppData {
    const ids = new Set(attachmentIds);
    if (ids.size === 0) return appData;

    return {
        ...appData,
        tasks: appData.tasks.map((task) => ({
            ...task,
            attachments: task.attachments?.filter((attachment) => !ids.has(attachment.id)),
        })),
        projects: appData.projects.map((project) => ({
            ...project,
            attachments: project.attachments?.filter((attachment) => !ids.has(attachment.id)),
        })),
    };
}

export type AttachmentCleanupApplyResult = {
    lastCleanupAt: string;
    pendingRemoteDeletes?: readonly PendingRemoteAttachmentDelete[];
    orphanedAttachments?: readonly Attachment[];
    processedOrphanedIds?: Iterable<string>;
    reachedBatchLimit?: boolean;
};

const parseTimestampMs = (value: unknown): number | null => {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export function shouldRetainPendingRemoteAttachmentDelete(
    entry: PendingRemoteAttachmentDelete,
    nowIso: string,
): boolean {
    const attempts = typeof entry.attempts === 'number' && Number.isFinite(entry.attempts)
        ? Math.max(0, Math.floor(entry.attempts))
        : 0;
    if (attempts >= PENDING_REMOTE_ATTACHMENT_DELETE_MAX_ATTEMPTS) return false;

    const lastErrorMs = parseTimestampMs(entry.lastErrorAt);
    if (lastErrorMs === null) return true;
    const nowMs = parseTimestampMs(nowIso);
    if (nowMs === null) return true;
    return nowMs - lastErrorMs <= PENDING_REMOTE_ATTACHMENT_DELETE_MAX_AGE_MS;
}

export function prunePendingRemoteAttachmentDeletes(
    pendingRemoteDeletes: readonly PendingRemoteAttachmentDelete[] | undefined,
    nowIso: string,
): PendingRemoteAttachmentDelete[] {
    if (!pendingRemoteDeletes?.length) return [];
    return pendingRemoteDeletes.filter((entry) =>
        shouldRetainPendingRemoteAttachmentDelete(entry, nowIso)
    );
}

export function applyAttachmentCleanupResult(appData: AppData, result: AttachmentCleanupApplyResult): AppData {
    const hasOrphaned = (result.orphanedAttachments?.length ?? 0) > 0;
    const cleaned = hasOrphaned
        ? result.reachedBatchLimit
            ? removeAttachmentsByIdFromData(appData, result.processedOrphanedIds ?? [])
            : removeOrphanedAttachmentsFromData(appData)
        : appData;
    const pendingRemoteDeletes = prunePendingRemoteAttachmentDeletes(
        result.pendingRemoteDeletes,
        result.lastCleanupAt,
    );
    const nextPendingRemoteDeletes = pendingRemoteDeletes.length
        ? pendingRemoteDeletes
        : undefined;

    return {
        ...cleaned,
        settings: {
            ...cleaned.settings,
            attachments: {
                ...cleaned.settings.attachments,
                lastCleanupAt: result.lastCleanupAt,
                pendingRemoteDeletes: nextPendingRemoteDeletes,
            },
        },
    };
}

export async function runAttachmentCleanupLifecycle(
    options: AttachmentCleanupLifecycleOptions,
): Promise<AttachmentCleanupLifecycleResult> {
    const orphanedAttachments = findOrphanedAttachments(options.appData);
    const deletedAttachments = findDeletedAttachmentsForFileCleanup(options.appData);
    const cleanupTargets = new Map<string, Attachment>();
    for (const attachment of orphanedAttachments) cleanupTargets.set(attachment.id, attachment);
    for (const attachment of deletedAttachments) cleanupTargets.set(attachment.id, attachment);

    const previousPendingRemoteDeletes = normalizePendingRemoteDeletes(
        options.appData.settings.attachments?.pendingRemoteDeletes,
    );
    const previousPendingByCloudKey = new Map<string, PendingRemoteAttachmentDelete>();
    for (const pending of previousPendingRemoteDeletes) {
        const cloudKey = sanitizeAttachmentCloudKeyForSyncMerge(pending.cloudKey);
        if (!cloudKey) continue;
        previousPendingByCloudKey.set(cloudKey, { ...pending, cloudKey });
    }

    const liveResourceReferences = findLiveAttachmentResourceReferences(options.appData);
    const remoteCleanupTargets = new Map<string, AttachmentCleanupRemoteTarget>();
    for (const pending of previousPendingByCloudKey.values()) {
        if (isAttachmentCloudResourceReferenced(pending, liveResourceReferences)) continue;
        remoteCleanupTargets.set(pending.cloudKey, {
            cloudKey: pending.cloudKey,
            title: pending.title || pending.cloudKey,
        });
    }

    const requestedLimit = options.maxAttachmentTargets;
    const maxAttachmentTargets = typeof requestedLimit === 'number' && Number.isFinite(requestedLimit)
        ? Math.max(0, Math.floor(requestedLimit))
        : Number.POSITIVE_INFINITY;
    const reachedBatchLimit = cleanupTargets.size > maxAttachmentTargets;
    const orphanedIds = new Set(orphanedAttachments.map((attachment) => attachment.id));
    const processedOrphanedIds = new Set<string>();
    let processedCount = 0;

    for (const attachment of cleanupTargets.values()) {
        if (processedCount >= maxAttachmentTargets) break;
        processedCount += 1;
        if (orphanedIds.has(attachment.id)) {
            processedOrphanedIds.add(attachment.id);
        }
        await options.beforeEachAttachment?.();
        if (!isAttachmentLocalResourceReferenced(attachment, liveResourceReferences)) {
            await options.deleteLocalAttachment(attachment);
        }
        const cloudKey = sanitizeAttachmentCloudKeyForSyncMerge(attachment.cloudKey);
        if (!cloudKey || isAttachmentCloudResourceReferenced({ cloudKey }, liveResourceReferences)) {
            continue;
        }
        remoteCleanupTargets.set(cloudKey, {
            cloudKey,
            title: attachment.title || cloudKey,
        });
    }

    const lastCleanupAt = (options.now ?? (() => new Date().toISOString()))();
    const nextPendingRemoteDeletesByCloudKey = new Map<string, PendingRemoteAttachmentDelete>();
    const deleteRemoteAttachment = options.deleteRemoteAttachment
        ?? (
            remoteCleanupTargets.size > 0
                ? await options.resolveRemoteDeleteAttachment?.()
                : undefined
        );
    for (const target of remoteCleanupTargets.values()) {
        const previous = previousPendingByCloudKey.get(target.cloudKey);
        if (!deleteRemoteAttachment) {
            nextPendingRemoteDeletesByCloudKey.set(target.cloudKey, {
                cloudKey: target.cloudKey,
                title: target.title,
                attempts: previous?.attempts ?? 0,
                lastErrorAt: previous?.lastErrorAt,
            });
            continue;
        }

        await options.beforeEachRemoteDelete?.();
        try {
            await deleteRemoteAttachment(target);
        } catch (error) {
            // Freshness guards deliberately throw this sentinel. It must abort
            // the whole cycle rather than being converted into a retryable
            // provider failure/pending delete.
            if (isLocalSyncAbortError(error)) throw error;
            if (getErrorStatus(error) === 404 || options.isRemoteMissingError?.(error)) {
                options.onRemoteAttachmentMissing?.(target);
                continue;
            }
            options.onRemoteDeleteError?.(target, error);
            nextPendingRemoteDeletesByCloudKey.set(target.cloudKey, {
                cloudKey: target.cloudKey,
                title: target.title,
                attempts: (previous?.attempts ?? 0) + 1,
                lastErrorAt: lastCleanupAt,
            });
        }
    }

    if (reachedBatchLimit && Number.isFinite(maxAttachmentTargets)) {
        options.onBatchLimitReached?.({
            limit: maxAttachmentTargets,
            total: cleanupTargets.size,
        });
    }

    const appData = applyAttachmentCleanupResult(options.appData, {
        lastCleanupAt,
        orphanedAttachments,
        pendingRemoteDeletes: Array.from(nextPendingRemoteDeletesByCloudKey.values()),
        processedOrphanedIds,
        reachedBatchLimit,
    });

    return {
        appData,
        orphanedAttachments,
        processedOrphanedIds,
        reachedBatchLimit,
        shouldInvalidateFastSyncState: (
            orphanedAttachments.length > 0
            && (!reachedBatchLimit || processedOrphanedIds.size > 0)
        ),
    };
}
