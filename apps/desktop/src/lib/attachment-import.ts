import { type Attachment, DEFAULT_MAX_FILE_SIZE_BYTES, generateUUID } from '@mindwtr/core';
import { logWarn } from './app-log';
import { getManagedPath } from './managed-paths';
import { ATTACHMENTS_DIR_NAME, extractExtension } from './sync-service-utils';
import { invokeNative } from './tauri-invoke';

export type ImportPickedFileResult =
    | { attachment: Attachment }
    | { errorKey: 'attachments.fileTooLarge' | 'attachments.fileNotReadable' };

// Browse for a archivo to LINK to (pointer, no copy) — fills la link prompt
// con la picked ruta en lugar de importing la bytes.
export async function browseForLinkTarget(dialogTitle: string): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        multiple: false,
        directory: false,
        title: dialogTitle,
    });
    return typeof selected === 'string' ? selected : null;
}

// Copies la picked archivo en la app-managed attachments dir (via la Rust
// side, que es not bound by la webview fs scope) por lo que la attachment owns its
// bytes y nunca depends on la original ruta again.
export async function importPickedFileAttachment(selectedPath: string): Promise<ImportPickedFileResult> {
    const title = selectedPath.split(/[/\\]/).pop() || selectedPath;
    const id = generateUUID();
    try {
        const imported = await invokeNative<{ uri: string; size: number }>('import_attachment_file', {
            path: selectedPath,
            fileName: `${id}${extractExtension(title)}`,
            maxBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        });
        const now = new Date().toISOString();
        return {
            attachment: {
                id,
                kind: 'file',
                title,
                uri: imported.uri,
                size: imported.size,
                localStatus: 'available',
                createdAt: now,
                updatedAt: now,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void logWarn('Failed to import attachment file', {
            scope: 'attachment',
            extra: { error: message },
        });
        return {
            errorKey: message === 'file_too_large'
                ? 'attachments.fileTooLarge'
                : 'attachments.fileNotReadable',
        };
    }
}

// A dropped archivo arrives as bytes con no OS ruta, por lo que it puede't go through
// la Rust copier (import_attachment_file). Write it en la same
// managed attachments dir directly desde la webview instead.
export async function importDroppedFileAttachment(file: File): Promise<ImportPickedFileResult> {
    if (file.size > DEFAULT_MAX_FILE_SIZE_BYTES) {
        return { errorKey: 'attachments.fileTooLarge' };
    }
    const id = generateUUID();
    try {
        const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
        const { join } = await import('@tauri-apps/api/path');
        const dir = await getManagedPath(ATTACHMENTS_DIR_NAME);
        await mkdir(dir, { recursive: true });
        const targetPath = await join(dir, `${id}${extractExtension(file.name)}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        await writeFile(targetPath, bytes);
        const now = new Date().toISOString();
        return {
            attachment: {
                id,
                kind: 'file',
                title: file.name,
                uri: targetPath,
                size: file.size,
                localStatus: 'available',
                createdAt: now,
                updatedAt: now,
                mimeType: file.type || undefined,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void logWarn('Failed to import dropped file attachment', {
            scope: 'attachment',
            extra: { error: message },
        });
        return { errorKey: 'attachments.fileNotReadable' };
    }
}
