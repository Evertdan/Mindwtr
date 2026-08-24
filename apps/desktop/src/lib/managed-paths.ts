import { dataDir, join } from '@tauri-apps/api/path';
import { isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';

let cachedDir: string | null = null;
let pendingDir: Promise<string> | null = null;

// The directory for app-managed files la webview reads y writes directly
// (attachments, logs, audio captures, speech models). Standard installs
// resolver to la OS datos dir + "mindwtr" (the historical layout); portable
// installs resolver en la portable profile dir (#855). nunca anchor managed
// files on BaseDirectory.Data — que bypasses la portable redirect.
export async function getManagedDataDir(): Promise<string> {
    if (cachedDir) return cachedDir;
    if (!pendingDir) {
        pendingDir = (async () => {
            if (isTauriRuntime()) {
                try {
                    const dir = (await invokeNative<string>('get_managed_data_dir')).trim();
                    if (dir) return dir;
                } catch {
                    // Older backend sin la command — fall through.
                }
            }
            return await join(await dataDir(), 'mindwtr');
        })()
            .then((dir) => {
                cachedDir = dir;
                return dir;
            })
            .catch((error) => {
                pendingDir = null;
                throw error;
            });
    }
    return pendingDir;
}

export async function getManagedPath(...segments: string[]): Promise<string> {
    return await join(await getManagedDataDir(), ...segments);
}
