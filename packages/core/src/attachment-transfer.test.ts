import { describe, expect, it, vi } from 'vitest';
import type { AppData, Attachment, Project, Task } from './types';
import {
    collectAttachmentsById,
    normalizePendingRemoteDeletes,
    runAttachmentTransferLifecycle,
} from './attachment-transfer';

const makeAttachment = (overrides: Partial<Attachment>): Attachment => ({
    id: 'attachment-1',
    kind: 'file',
    title: 'Attachment',
    uri: '/local/file.txt',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const makeTask = (overrides: Partial<Task>): Task => ({
    id: 'task-1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const makeProject = (overrides: Partial<Project>): Project => ({
    id: 'project-1',
    title: 'Project',
    color: '#94a3b8',
    order: 0,
    status: 'active',
    tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const makeData = (overrides: Partial<AppData>): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
    ...overrides,
});

describe('runAttachmentTransferLifecycle', () => {
    it('uploads local file attachments that do not yet have a cloud key', async () => {
        const attachment = makeAttachment({ localStatus: 'missing' });
        const onUpload = vi.fn(async (item: Attachment) => {
            item.cloudKey = 'attachments/attachment-1.txt';
            return true;
        });
        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists: vi.fn(async () => true),
            onUpload,
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(true);
        expect(attachment.localStatus).toBe('available');
        expect(attachment.cloudKey).toBe('attachments/attachment-1.txt');
        expect(onUpload).toHaveBeenCalledWith(attachment, '/local/file.txt');
    });

    it('downloads remote attachments when the local file is missing', async () => {
        const attachment = makeAttachment({ cloudKey: 'attachments/attachment-1.txt', localStatus: 'available' });
        const onDownload = vi.fn(async (item: Attachment) => {
            item.uri = '/local/downloaded.txt';
            item.localStatus = 'available';
            return true;
        });
        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists: vi.fn(async () => false),
            onUpload: vi.fn(),
            onUploadError: vi.fn(),
            onDownload,
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(true);
        expect(onDownload).toHaveBeenCalledWith(attachment);
        expect(attachment.uri).toBe('/local/downloaded.txt');
    });

    it('is a no-op on the second aligned pass', async () => {
        const attachment = makeAttachment({ cloudKey: 'attachments/attachment-1.txt', localStatus: 'available' });
        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists: vi.fn(async () => true),
            onUpload: vi.fn(),
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(false);
    });

    it('can force a local file to be uploaded to a newly activated backend', async () => {
        const attachment = makeAttachment({
            cloudKey: 'attachments/from-previous-backend.txt',
            localStatus: 'available',
        });
        const onUpload = vi.fn(async (item: Attachment) => {
            // The previous backend key must not survive a failed candidate
            // upload and masquerade as proof that the candidate has the blob.
            expect(item.cloudKey).toBeUndefined();
            item.cloudKey = 'attachments/on-candidate-backend.txt';
            return true;
        });

        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists: vi.fn(async () => true),
            forceUploadExistingLocal: true,
            onUpload,
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(true);
        expect(onUpload).toHaveBeenCalledWith(attachment, '/local/file.txt');
        expect(attachment.cloudKey).toBe('attachments/on-candidate-backend.txt');
    });

    it('does not retain the previous backend key when a forced candidate upload fails', async () => {
        const attachment = makeAttachment({
            cloudKey: 'attachments/from-previous-backend.txt',
            localStatus: 'available',
        });
        const uploadError = new Error('candidate upload failed');
        const onUploadError = vi.fn();

        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists: vi.fn(async () => true),
            forceUploadExistingLocal: true,
            onUpload: vi.fn(async () => { throw uploadError; }),
            onUploadError,
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(true);
        expect(attachment.cloudKey).toBeUndefined();
        expect(onUploadError).toHaveBeenCalledWith(attachment, uploadError);
    });

    it('routes transfer errors to the operation-specific error callbacks', async () => {
        const uploadAttachment = makeAttachment({ id: 'upload', uri: '/local/upload.txt' });
        const downloadAttachment = makeAttachment({ id: 'download', uri: '/local/missing.txt', cloudKey: 'attachments/download.txt' });
        const uploadError = new Error('upload failed');
        const downloadError = new Error('download failed');
        const onUploadError = vi.fn();
        const onDownloadError = vi.fn();

        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([
                [uploadAttachment.id, uploadAttachment],
                [downloadAttachment.id, downloadAttachment],
            ]),
            localFileExists: vi.fn(async (path) => path === '/local/upload.txt'),
            onUpload: vi.fn(async () => { throw uploadError; }),
            onUploadError,
            onDownload: vi.fn(async () => { throw downloadError; }),
            onDownloadError,
        });

        expect(didMutate).toBe(true);
        expect(onUploadError).toHaveBeenCalledWith(uploadAttachment, uploadError);
        expect(onDownloadError).toHaveBeenCalledWith(downloadAttachment, downloadError);
    });

    it('skips deleted and non-file attachments', async () => {
        const deleted = makeAttachment({ id: 'deleted', deletedAt: '2026-01-02T00:00:00.000Z' });
        const link = makeAttachment({ id: 'link', kind: 'link', uri: 'https://example.test' });
        const localFileExists = vi.fn(async () => true);
        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[deleted.id, deleted], [link.id, link]]),
            localFileExists,
            onUpload: vi.fn(),
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(false);
        expect(localFileExists).not.toHaveBeenCalled();
    });

    it('supports a custom hasCloudCopy predicate for backends whose cloudKey format differs', async () => {
        // Simulates CloudKit: a cloudKey written by a different backend before a provider switch
        // isn't a valid CloudKit record key, so CloudKit must still upload.
        const attachment = makeAttachment({ cloudKey: 'attachments/from-other-backend.txt' });
        const onUpload = vi.fn(async () => true);
        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists: vi.fn(async () => true),
            hasCloudCopy: (item) => item.cloudKey?.startsWith('cloudkit:') ?? false,
            onUpload,
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(didMutate).toBe(true);
        expect(onUpload).toHaveBeenCalledWith(attachment, '/local/file.txt');
    });

    it('lets a policy cap uploads and downloads without touching the default (uncapped) callers', async () => {
        const uploadA = makeAttachment({ id: 'upload-a', uri: '/local/a.txt' });
        const uploadB = makeAttachment({ id: 'upload-b', uri: '/local/b.txt' });
        const onUpload = vi.fn(async () => true);
        const shouldUpload = vi.fn(() => false);

        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[uploadA.id, uploadA], [uploadB.id, uploadB]]),
            localFileExists: vi.fn(async () => true),
            onUpload,
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
            policy: { shouldUpload },
        });

        expect(onUpload).not.toHaveBeenCalled();
        expect(shouldUpload).toHaveBeenCalledTimes(2);
        // localStatus still refreshes even when the cap blocks the transfer itself.
        expect(didMutate).toBe(true);
        expect(uploadA.localStatus).toBe('available');
    });

    it('lets a policy skip an attachment entirely, including its local-status refresh', async () => {
        const attachment = makeAttachment({ localStatus: 'missing' });
        const localFileExists = vi.fn(async () => true);
        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists,
            onUpload: vi.fn(),
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
            policy: { shouldSkip: () => true },
        });

        expect(didMutate).toBe(false);
        expect(localFileExists).not.toHaveBeenCalled();
        expect(attachment.localStatus).toBe('missing');
    });

    it('gates downloads through a policy backoff without affecting other attachments', async () => {
        const backedOff = makeAttachment({ id: 'backed-off', cloudKey: 'attachments/backed-off.txt' });
        const ready = makeAttachment({ id: 'ready', cloudKey: 'attachments/ready.txt' });
        const onDownload = vi.fn(async () => true);
        const shouldDownload = vi.fn((attachment: Attachment) => attachment.id !== 'backed-off');

        const didMutate = await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[backedOff.id, backedOff], [ready.id, ready]]),
            localFileExists: vi.fn(async () => false),
            onUpload: vi.fn(),
            onUploadError: vi.fn(),
            onDownload,
            onDownloadError: vi.fn(),
            policy: { shouldDownload },
        });

        expect(didMutate).toBe(true);
        expect(onDownload).toHaveBeenCalledTimes(1);
        expect(onDownload).toHaveBeenCalledWith(ready);
    });

    it('rethrows a fatal error immediately instead of routing it to onUploadError, keeping earlier mutations', async () => {
        // Mirrors an AbortSignal firing mid-run on a mobile backend: the first attachment's
        // upload already succeeded and mutated in place before the second attachment's upload
        // hits the fatal error, so the whole call rejects but attachment #1 stays mutated.
        const first = makeAttachment({ id: 'first', uri: '/local/first.txt' });
        const second = makeAttachment({ id: 'second', uri: '/local/second.txt' });
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        const onUpload = vi.fn(async (item: Attachment) => {
            if (item.id === 'second') throw abortError;
            item.cloudKey = 'attachments/first.txt';
            return true;
        });
        const onUploadError = vi.fn();

        await expect(runAttachmentTransferLifecycle({
            attachmentsById: new Map([[first.id, first], [second.id, second]]),
            localFileExists: vi.fn(async () => true),
            onUpload,
            onUploadError,
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
            isFatalError: (error) => error instanceof Error && error.name === 'AbortError',
        })).rejects.toBe(abortError);

        expect(onUploadError).not.toHaveBeenCalled();
        expect(first.cloudKey).toBe('attachments/first.txt');
    });

    it('lets platform adapters resolve local URI paths', async () => {
        const attachment = makeAttachment({ uri: 'file:///tmp/upload.txt' });
        const localFileExists = vi.fn(async () => true);
        await runAttachmentTransferLifecycle({
            attachmentsById: new Map([[attachment.id, attachment]]),
            localFileExists,
            resolveLocalPath: (uri) => uri.replace('file://', ''),
            onUpload: vi.fn(async () => false),
            onUploadError: vi.fn(),
            onDownload: vi.fn(),
            onDownloadError: vi.fn(),
        });

        expect(localFileExists).toHaveBeenCalledWith(
            '/tmp/upload.txt',
            expect.objectContaining({ id: 'attachment-1' }),
        );
    });
});

describe('collectAttachmentsById', () => {
    it('collects live task and project attachments and skips deleted owners', () => {
        const taskAttachment = makeAttachment({ id: 'task-attachment' });
        const projectAttachment = makeAttachment({ id: 'project-attachment' });
        const deletedOwnerAttachment = makeAttachment({ id: 'deleted-owner-attachment' });
        const data = makeData({
            tasks: [
                makeTask({ id: 'task-live', attachments: [taskAttachment] }),
                makeTask({ id: 'task-deleted', deletedAt: '2026-01-02T00:00:00.000Z', attachments: [deletedOwnerAttachment] }),
            ],
            projects: [makeProject({ id: 'project-live', attachments: [projectAttachment] })],
        });

        expect([...collectAttachmentsById(data).keys()]).toEqual(['task-attachment', 'project-attachment']);
    });
});

describe('normalizePendingRemoteDeletes', () => {
    it('dedupes by cloud key and keeps the highest attempt count', () => {
        expect(normalizePendingRemoteDeletes([
            { cloudKey: ' attachments/a.txt ', attempts: 1, title: 'old' },
            { cloudKey: 'attachments/a.txt', attempts: 3, title: 'new' },
            { cloudKey: '', attempts: 9 },
        ])).toEqual([
            { cloudKey: 'attachments/a.txt', attempts: 3, title: 'new', lastErrorAt: undefined },
        ]);
    });
});
