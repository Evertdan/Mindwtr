import { open as openShell } from '@tauri-apps/plugin-shell';
import { isLocalAttachmentPath, resolveAttachmentOpenTarget, toAttachmentBrowserUrl } from './attachment-paths';
import { isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';

export async function openAttachmentTarget(uri: string, attachmentId?: string): Promise<void> {
    const trimmed = uri.trim();
    if (!trimmed) return;

    if (isTauriRuntime()) {
        if (!isLocalAttachmentPath(trimmed)) {
            await openShell(trimmed);
            return;
        }

        await invokeNative('open_path', {
            path: resolveAttachmentOpenTarget(trimmed),
            attachmentId,
        });
        return;
    }

    window.open(toAttachmentBrowserUrl(trimmed), '_blank');
}
