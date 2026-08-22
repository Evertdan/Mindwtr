import { describe, expect, it, vi } from 'vitest';
import {
    applyAttachmentCleanupResult,
    findDeletedAttachmentsForFileCleanup,
    findLiveAttachmentResourceReferences,
    findOrphanedAttachments,
    isAttachmentCloudResourceReferenced,
    isAttachmentLocalResourceReferenced,
    PENDING_REMOTE_ATTACHMENT_DELETE_MAX_ATTEMPTS,
    removeAttachmentsByIdFromData,
    removeOrphanedAttachmentsFromData,
    runAttachmentCleanupLifecycle,
} from './attachment-cleanup';
import type { AppData } from './types';

const buildData = (): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
});

describe('findOrphanedAttachments', () => {
    it('treats deleted attachments on active tasks as orphaned cleanup candidates', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned.map((attachment) => attachment.id)).toEqual(['a1']);
    });

    it('keeps attachments on deleted but restorable tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned).toHaveLength(0);
    });

    it('detects attachments on purged tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            purgedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned.map((a) => a.id)).toEqual(['a1']);
    });

    it('keeps attachments on deleted but restorable projects until purge', () => {
        const data = buildData();
        data.projects.push({
            id: 'p1',
            title: 'Project',
            status: 'active',
            color: '#2563eb',
            order: 0,
            tagIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [{
                id: 'a1',
                kind: 'file',
                title: 'file',
                uri: '/tmp/project-file',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }],
        });

        expect(findOrphanedAttachments(data)).toHaveLength(0);

        data.projects[0].purgedAt = new Date().toISOString();
        expect(findOrphanedAttachments(data).map((attachment) => attachment.id)).toEqual(['a1']);
    });

    it('keeps attachments referenced by active tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned).toHaveLength(0);
    });
});

describe('findDeletedAttachmentsForFileCleanup', () => {
    it('finds deleted attachments on active tasks and projects', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'audio',
                    uri: '',
                    cloudKey: 'attachments/a1.m4a',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });
        data.projects.push({
            id: 'p1',
            title: 'Project',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a2',
                    kind: 'file',
                    title: 'doc',
                    uri: '/tmp/doc',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const deleted = findDeletedAttachmentsForFileCleanup(data);
        expect(deleted.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    });

    it('returns deleted attachments even when parents are deleted', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const deleted = findDeletedAttachmentsForFileCleanup(data);
        expect(deleted.map((a) => a.id)).toEqual(['a1']);
    });
});

describe('findLiveAttachmentResourceReferences', () => {
    it('tracks live local URIs and cloud keys while ignoring purged records', () => {
        const data = buildData();
        data.tasks.push({
            id: 'live-task',
            title: 'Live',
            status: 'inbox',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            attachments: [
                {
                    id: 'live',
                    kind: 'file',
                    title: 'live',
                    uri: 'file:///tmp/shared',
                    cloudKey: 'attachments/shared.txt',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
                {
                    id: 'deleted',
                    kind: 'file',
                    title: 'deleted',
                    uri: '/tmp/deleted',
                    cloudKey: 'attachments/deleted.txt',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                    deletedAt: '2026-01-02T00:00:00.000Z',
                },
            ],
        });
        data.projects.push({
            id: 'deleted-project',
            title: 'Deleted Project',
            status: 'active',
            color: '#000000',
            order: 0,
            tagIds: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: '2026-01-02T00:00:00.000Z',
            purgedAt: '2026-01-02T00:00:00.000Z',
            attachments: [
                {
                    id: 'deleted-parent',
                    kind: 'file',
                    title: 'deleted-parent',
                    uri: '/tmp/deleted-parent',
                    cloudKey: 'attachments/deleted-parent.txt',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });

        const references = findLiveAttachmentResourceReferences(data);
        expect(Array.from(references.localUris)).toEqual(['/tmp/shared']);
        expect(Array.from(references.cloudKeys)).toEqual(['attachments/shared.txt']);
    });

    it('detects cleanup targets that share a live local URI or cloud key', () => {
        const data = buildData();
        data.tasks.push({
            id: 'live-task',
            title: 'Live',
            status: 'inbox',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            attachments: [
                {
                    id: 'live',
                    kind: 'file',
                    title: 'live',
                    uri: '/tmp/shared',
                    cloudKey: 'attachments/shared.txt',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });

        const references = findLiveAttachmentResourceReferences(data);
        expect(isAttachmentLocalResourceReferenced({
            id: 'orphan',
            kind: 'file',
            title: 'orphan',
            uri: 'file:///tmp/shared',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        }, references)).toBe(true);
        expect(isAttachmentCloudResourceReferenced({
            cloudKey: 'attachments/shared.txt',
        }, references)).toBe(true);
        expect(isAttachmentLocalResourceReferenced({
            id: 'other',
            kind: 'file',
            title: 'other',
            uri: '/tmp/other',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        }, references)).toBe(false);
        expect(isAttachmentCloudResourceReferenced({
            cloudKey: 'attachments/other.txt',
        }, references)).toBe(false);
    });

    const buildLiveReferences = (uri: string) => {
        const data = buildData();
        data.tasks.push({
            id: 'live-task',
            title: 'Live',
            status: 'inbox',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            attachments: [{
                id: 'live',
                kind: 'file',
                title: 'live',
                uri,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            }],
        });
        return findLiveAttachmentResourceReferences(data);
    };

    const orphanWithUri = (uri: string) => ({
        id: 'orphan',
        kind: 'file' as const,
        title: 'orphan',
        uri,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    });

    it('matches percent-encoded and decoded spellings of the same local uri', () => {
        expect(isAttachmentLocalResourceReferenced(
            orphanWithUri('/a/My File.pdf'),
            buildLiveReferences('file:///a/My%20File.pdf'),
        )).toBe(true);
        expect(isAttachmentLocalResourceReferenced(
            orphanWithUri('file:///a/My%20File.pdf'),
            buildLiveReferences('/a/My File.pdf'),
        )).toBe(true);
    });

    it('matches a backslash-separated windows path against its forward-slash twin', () => {
        expect(isAttachmentLocalResourceReferenced(
            orphanWithUri('C:/Users/me/Docs/report.pdf'),
            buildLiveReferences('C:\\Users\\me\\Docs\\report.pdf'),
        )).toBe(true);
    });

    it('tolerates malformed percent sequences without throwing', () => {
        expect(() => buildLiveReferences('/a/100%.pdf')).not.toThrow();
        expect(isAttachmentLocalResourceReferenced(
            orphanWithUri('/a/100%.pdf'),
            buildLiveReferences('/a/100%.pdf'),
        )).toBe(true);
    });
});

describe('removeOrphanedAttachmentsFromData', () => {
    it('removes orphaned attachments from tasks and projects', () => {
        const data: AppData = {
            tasks: [
                {
                    id: 't1',
                    title: 'Task',
                    status: 'done',
                    contexts: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                    purgedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'a1',
                            kind: 'file',
                            title: 'file',
                            uri: '/tmp/file',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            projects: [
                {
                    id: 'p1',
                    title: 'Project',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'a2',
                            kind: 'file',
                            title: 'file2',
                            uri: '/tmp/file2',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            deletedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            sections: [],
            areas: [],
            settings: {},
        };

        const cleaned = removeOrphanedAttachmentsFromData(data);
        expect(cleaned.tasks[0].attachments).toHaveLength(0);
        expect(cleaned.projects[0].attachments).toHaveLength(0);
    });
});

describe('removeAttachmentsByIdFromData', () => {
    it('removes only requested attachments', () => {
        const data: AppData = {
            tasks: [
                {
                    id: 't1',
                    title: 'Task',
                    status: 'inbox',
                    contexts: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'keep-task',
                            kind: 'file',
                            title: 'keep-task',
                            uri: '/tmp/keep-task',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                        {
                            id: 'drop-task',
                            kind: 'file',
                            title: 'drop-task',
                            uri: '/tmp/drop-task',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            projects: [
                {
                    id: 'p1',
                    title: 'Project',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'drop-project',
                            kind: 'file',
                            title: 'drop-project',
                            uri: '/tmp/drop-project',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            sections: [],
            areas: [],
            settings: {},
        };

        const cleaned = removeAttachmentsByIdFromData(data, ['drop-task', 'drop-project']);
        expect(cleaned.tasks[0].attachments?.map((attachment) => attachment.id)).toEqual(['keep-task']);
        expect(cleaned.projects[0].attachments ?? []).toHaveLength(0);
    });
});

describe('applyAttachmentCleanupResult', () => {
    it('stores cleanup metadata and removes all orphaned attachments when not batch-limited', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: '2026-01-01T00:00:00.000Z',
            purgedAt: '2026-01-01T00:00:00.000Z',
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        const cleaned = applyAttachmentCleanupResult(data, {
            lastCleanupAt: '2026-01-02T00:00:00.000Z',
            orphanedAttachments: orphaned,
            pendingRemoteDeletes: [{ cloudKey: 'attachments/missing.txt', attempts: 1 }],
        });

        expect(cleaned.tasks[0].attachments).toEqual([]);
        expect(cleaned.settings.attachments?.lastCleanupAt).toBe('2026-01-02T00:00:00.000Z');
        expect(cleaned.settings.attachments?.pendingRemoteDeletes).toEqual([
            { cloudKey: 'attachments/missing.txt', attempts: 1 },
        ]);
    });

    it('drops pending remote attachment deletes after max attempts or expiry', () => {
        const data = buildData();

        const cleaned = applyAttachmentCleanupResult(data, {
            lastCleanupAt: '2026-02-01T00:00:00.000Z',
            pendingRemoteDeletes: [
                {
                    cloudKey: 'attachments/too-many.txt',
                    attempts: PENDING_REMOTE_ATTACHMENT_DELETE_MAX_ATTEMPTS,
                    lastErrorAt: '2026-01-31T00:00:00.000Z',
                },
                {
                    cloudKey: 'attachments/too-old.txt',
                    attempts: 1,
                    lastErrorAt: '2025-12-01T00:00:00.000Z',
                },
                {
                    cloudKey: 'attachments/recent.txt',
                    attempts: 1,
                    lastErrorAt: '2026-01-31T00:00:00.000Z',
                },
            ],
        });

        expect(cleaned.settings.attachments?.pendingRemoteDeletes).toEqual([
            {
                cloudKey: 'attachments/recent.txt',
                attempts: 1,
                lastErrorAt: '2026-01-31T00:00:00.000Z',
            },
        ]);
    });

    it('removes only processed orphaned attachments when batch-limited', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: '2026-01-01T00:00:00.000Z',
            purgedAt: '2026-01-01T00:00:00.000Z',
            attachments: [
                {
                    id: 'processed',
                    kind: 'file',
                    title: 'processed',
                    uri: '/tmp/processed',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
                {
                    id: 'deferred',
                    kind: 'file',
                    title: 'deferred',
                    uri: '/tmp/deferred',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });

        const cleaned = applyAttachmentCleanupResult(data, {
            lastCleanupAt: '2026-01-02T00:00:00.000Z',
            orphanedAttachments: findOrphanedAttachments(data),
            processedOrphanedIds: ['processed'],
            reachedBatchLimit: true,
        });

        expect(cleaned.tasks[0].attachments?.map((attachment) => attachment.id)).toEqual(['deferred']);
        expect(cleaned.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
    });
});

describe('runAttachmentCleanupLifecycle', () => {
    const now = '2026-07-14T12:00:00.000Z';

    it('removes orphaned metadata without deleting resources still referenced by a live task', async () => {
        const data = buildData();
        data.tasks.push(
            {
                id: 'purged',
                title: 'Purged',
                status: 'done',
                contexts: [],
                createdAt: now,
                updatedAt: now,
                deletedAt: now,
                purgedAt: now,
                attachments: [{
                    id: 'orphan',
                    kind: 'file',
                    title: 'shared',
                    uri: 'file:///managed/shared.pdf',
                    cloudKey: 'attachments/shared.pdf',
                    createdAt: now,
                    updatedAt: now,
                }],
            },
            {
                id: 'live',
                title: 'Live',
                status: 'next',
                contexts: [],
                createdAt: now,
                updatedAt: now,
                attachments: [{
                    id: 'live-copy',
                    kind: 'file',
                    title: 'shared',
                    uri: '/managed/shared.pdf',
                    cloudKey: 'attachments/shared.pdf',
                    createdAt: now,
                    updatedAt: now,
                }],
            },
        );
        const deleteLocalAttachment = vi.fn(async () => undefined);
        const deleteRemoteAttachment = vi.fn(async () => undefined);

        const result = await runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            deleteLocalAttachment,
            deleteRemoteAttachment,
        });

        expect(deleteLocalAttachment).not.toHaveBeenCalled();
        expect(deleteRemoteAttachment).not.toHaveBeenCalled();
        expect(result.appData.tasks[0].attachments).toEqual([]);
        expect(result.appData.tasks[1].attachments?.map((attachment) => attachment.id)).toEqual(['live-copy']);
        expect(result.shouldInvalidateFastSyncState).toBe(true);
    });

    it('treats attachments on soft-deleted parents as live resource references', async () => {
        const data = buildData();
        data.tasks.push({
            id: 'restorable',
            title: 'Restorable',
            status: 'done',
            contexts: [],
            createdAt: now,
            updatedAt: now,
            deletedAt: now,
            attachments: [{
                id: 'restorable-attachment',
                kind: 'file',
                title: 'keep',
                uri: '/managed/keep.pdf',
                cloudKey: 'attachments/keep.pdf',
                createdAt: now,
                updatedAt: now,
            }],
        });
        data.settings.attachments = {
            pendingRemoteDeletes: [{
                cloudKey: 'attachments/keep.pdf',
                title: 'keep',
                attempts: 1,
                lastErrorAt: now,
            }],
        };
        const deleteRemoteAttachment = vi.fn(async () => undefined);

        const result = await runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            deleteLocalAttachment: vi.fn(async () => undefined),
            deleteRemoteAttachment,
        });

        expect(deleteRemoteAttachment).not.toHaveBeenCalled();
        expect(result.appData.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
        expect(result.appData.tasks[0].attachments).toHaveLength(1);
    });

    it('keeps a live cloud key that needs sanitizing out of the remote delete queue', async () => {
        const data = buildData();
        data.tasks.push(
            {
                id: 'purged',
                title: 'Purged',
                status: 'done',
                contexts: [],
                createdAt: now,
                updatedAt: now,
                deletedAt: now,
                purgedAt: now,
                attachments: [{
                    id: 'orphan',
                    kind: 'file',
                    title: 'shared',
                    uri: '/managed/orphan-copy.pdf',
                    cloudKey: 'attachments/shared.pdf',
                    createdAt: now,
                    updatedAt: now,
                }],
            },
            {
                id: 'live',
                title: 'Live',
                status: 'next',
                contexts: [],
                createdAt: now,
                updatedAt: now,
                attachments: [{
                    id: 'live-copy',
                    kind: 'file',
                    title: 'shared',
                    uri: '/managed/shared.pdf',
                    cloudKey: '  attachments/shared.pdf  ',
                    createdAt: now,
                    updatedAt: now,
                }],
            },
        );
        const deleteRemoteAttachment = vi.fn(async () => undefined);

        const result = await runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            deleteLocalAttachment: vi.fn(async () => undefined),
            deleteRemoteAttachment,
        });

        expect(deleteRemoteAttachment).not.toHaveBeenCalled();
        expect(result.appData.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
    });

    it('treats remote 404 as terminal instead of scheduling another retry', async () => {
        const data = buildData();
        data.settings.attachments = {
            pendingRemoteDeletes: [{
                cloudKey: 'attachments/missing.pdf',
                title: 'missing',
                attempts: 2,
                lastErrorAt: now,
            }],
        };
        const onRemoteAttachmentMissing = vi.fn();

        const result = await runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            deleteLocalAttachment: vi.fn(async () => undefined),
            deleteRemoteAttachment: vi.fn(async () => {
                throw Object.assign(new Error('missing'), { status: 404 });
            }),
            onRemoteAttachmentMissing,
        });

        expect(onRemoteAttachmentMissing).toHaveBeenCalledWith(
            expect.objectContaining({ cloudKey: 'attachments/missing.pdf' }),
        );
        expect(result.appData.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
    });

    it('increments retry state for retryable remote deletion failures', async () => {
        const data = buildData();
        data.settings.attachments = {
            pendingRemoteDeletes: [{
                cloudKey: 'attachments/retry.pdf',
                title: 'retry',
                attempts: 2,
                lastErrorAt: '2026-07-13T12:00:00.000Z',
            }],
        };
        const error = new Error('offline');
        const onRemoteDeleteError = vi.fn();

        const result = await runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            deleteLocalAttachment: vi.fn(async () => undefined),
            deleteRemoteAttachment: vi.fn(async () => {
                throw error;
            }),
            onRemoteDeleteError,
        });

        expect(onRemoteDeleteError).toHaveBeenCalledWith(
            expect.objectContaining({ cloudKey: 'attachments/retry.pdf' }),
            error,
        );
        expect(result.appData.settings.attachments?.pendingRemoteDeletes).toEqual([{
            cloudKey: 'attachments/retry.pdf',
            title: 'retry',
            attempts: 3,
            lastErrorAt: now,
        }]);
    });

    it('propagates LocalSyncAbort from the final remote-delete freshness guard', async () => {
        const data = buildData();
        data.settings.attachments = {
            pendingRemoteDeletes: [{
                cloudKey: 'attachments/stale.pdf',
                title: 'stale',
            }],
        };
        const abort = new Error('Local changes detected during sync');
        abort.name = 'LocalSyncAbort';
        const onRemoteDeleteError = vi.fn();

        await expect(runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            deleteLocalAttachment: vi.fn(async () => undefined),
            deleteRemoteAttachment: vi.fn(async () => {
                throw abort;
            }),
            onRemoteDeleteError,
        })).rejects.toBe(abort);

        expect(onRemoteDeleteError).not.toHaveBeenCalled();
    });

    it('applies only the processed orphaned metadata when the batch limit is reached', async () => {
        const data = buildData();
        data.tasks.push({
            id: 'purged',
            title: 'Purged',
            status: 'done',
            contexts: [],
            createdAt: now,
            updatedAt: now,
            deletedAt: now,
            purgedAt: now,
            attachments: ['first', 'second'].map((id) => ({
                id,
                kind: 'file' as const,
                title: id,
                uri: '/managed/' + id + '.pdf',
                createdAt: now,
                updatedAt: now,
            })),
        });
        const deleteLocalAttachment = vi.fn(async () => undefined);
        const onBatchLimitReached = vi.fn();

        const result = await runAttachmentCleanupLifecycle({
            appData: data,
            now: () => now,
            maxAttachmentTargets: 1,
            deleteLocalAttachment,
            onBatchLimitReached,
        });

        expect(deleteLocalAttachment).toHaveBeenCalledTimes(1);
        expect(result.appData.tasks[0].attachments?.map((attachment) => attachment.id)).toEqual(['second']);
        expect(result.reachedBatchLimit).toBe(true);
        expect(result.processedOrphanedIds).toEqual(new Set(['first']));
        expect(onBatchLimitReached).toHaveBeenCalledWith({ limit: 1, total: 2 });
    });
});
