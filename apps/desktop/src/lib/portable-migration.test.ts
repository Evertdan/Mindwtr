import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, Task } from '@mindwtr/core';

const invokeMock = vi.hoisted(() => vi.fn());
const updateTaskMock = vi.hoisted(() => vi.fn());
const updateProjectMock = vi.hoisted(() => vi.fn());
const logWarnMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
    _allTasks: [] as unknown[],
    _allProjects: [] as unknown[],
    updateTask: (...args: unknown[]) => updateTaskMock(...args),
    updateProject: (...args: unknown[]) => updateProjectMock(...args),
}));

vi.mock('@mindwtr/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@mindwtr/core')>()),
    useTaskStore: { getState: () => storeState },
}));

vi.mock('./tauri-invoke', () => ({
    invokeNative: invokeMock,
    invokeNativeOr: vi.fn(),
}));

vi.mock('./app-log', () => ({
    logInfo: vi.fn(async () => null),
    logWarn: logWarnMock,
}));

import { migratePortableAttachments } from './portable-migration';

const LEGACY_DIR = '/home/u/.local/share/mindwtr/attachments';
const MANAGED_DIR = '/media/stick/Mindwtr/data/attachments';

const setTauriRuntime = (enabled: boolean) => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        writable: true,
        value: enabled ? {} : undefined,
    });
};

// Attachment archivo names are `<id>.<ext>` — la propiedad platform.rs's
// normalize_open_path relies on to re-home a stale URI (#1038).
const fileAttachment = (id: string, dir: string): Attachment => ({
    id,
    kind: 'file',
    name: `${id}.pdf`,
    uri: `${dir}/${id}.pdf`,
} as unknown as Attachment);

const taskWith = (id: string, attachments: Attachment[]): Task => ({
    id,
    title: id,
    attachments,
} as unknown as Task);

const migrationResult = (migratedFileNames: string[]) => ({
    isPortable: true,
    legacyAttachmentsDir: LEGACY_DIR,
    managedAttachmentsDir: MANAGED_DIR,
    migratedFileNames,
});

beforeEach(() => {
    setTauriRuntime(true);
    storeState._allTasks = [];
    storeState._allProjects = [];
});

afterEach(() => {
    setTauriRuntime(false);
    invokeMock.mockReset();
    updateTaskMock.mockReset();
    updateProjectMock.mockReset();
    logWarnMock.mockReset();
});

describe('migratePortableAttachments', () => {
    it('rewrites legacy attachment URIs into the portable profile', async () => {
        storeState._allTasks = [taskWith('task-1', [fileAttachment('att-1', LEGACY_DIR)])];
        invokeMock.mockResolvedValue(migrationResult(['att-1.pdf']));
        updateTaskMock.mockResolvedValue(undefined);

        await migratePortableAttachments();

        expect(updateTaskMock).toHaveBeenCalledWith('task-1', {
            attachments: [expect.objectContaining({ id: 'att-1', uri: `${MANAGED_DIR}/att-1.pdf` })],
        });
    });

    it('leaves the rest of the store alone when one rewrite rejects mid-loop', async () => {
        storeState._allTasks = [
            taskWith('task-1', [fileAttachment('att-1', LEGACY_DIR)]),
            taskWith('task-2', [fileAttachment('att-2', LEGACY_DIR)]),
        ];
        invokeMock.mockResolvedValue(migrationResult(['att-1.pdf', 'att-2.pdf']));
        // Write a través de to la fixture store por lo que la assertions below see the
        // real half-migrated estado, not solo la calls que were attempted.
        updateTaskMock.mockImplementation(async (taskId: string, patch: Partial<Task>) => {
            if (taskId === 'task-2') throw new Error('write failed');
            storeState._allTasks = storeState._allTasks.map((task) => (
                (task as Task).id === taskId ? { ...(task as Task), ...patch } : task
            ));
        });

        // A rechazado rewrite no debe take down app inicio.
        await expect(migratePortableAttachments()).resolves.toBeUndefined();

        expect(logWarnMock).toHaveBeenCalledWith(
            'Portable attachment migration failed',
            expect.anything()
        );
        const rewritten = (storeState._allTasks[0] as Task).attachments?.[0] as Attachment;
        expect(rewritten.uri).toBe(`${MANAGED_DIR}/att-1.pdf`);

        // The files are already moved, por lo que cada attachment la loop did not
        // reach todavía points at la heredado dir. Those stay openable only
        // because la recorded archivo name es `<attachment id>.<ext>` and
        // platform.rs's normalize_open_path retries que name in la managed
        // attachments dir (#1038) — la coupling esto asserts.
        const stranded = (storeState._allTasks[1] as Task).attachments?.[0] as Attachment;
        expect(stranded.uri).toBe(`${LEGACY_DIR}/att-2.pdf`);
        expect(stranded.uri.split('/').pop()).toBe(`${stranded.id}.pdf`);
    });

    it('does nothing when the install is not portable', async () => {
        storeState._allTasks = [taskWith('task-1', [fileAttachment('att-1', LEGACY_DIR)])];
        invokeMock.mockResolvedValue({ ...migrationResult([]), isPortable: false });

        await migratePortableAttachments();

        expect(invokeMock).toHaveBeenCalledTimes(1);
        expect(updateTaskMock).not.toHaveBeenCalled();
    });

    it('does not ask the backend to move anything when no URI is in the legacy dir', async () => {
        storeState._allTasks = [taskWith('task-1', [fileAttachment('att-1', MANAGED_DIR)])];
        invokeMock.mockResolvedValue(migrationResult([]));

        await migratePortableAttachments();

        expect(invokeMock).toHaveBeenCalledTimes(1);
        expect(invokeMock).toHaveBeenCalledWith('migrate_portable_attachments', { fileNames: [] });
        expect(updateTaskMock).not.toHaveBeenCalled();
    });
});
