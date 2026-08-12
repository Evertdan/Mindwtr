import { logError } from './app-log';
import { invokeNative } from './tauri-invoke';

/**
 * Hides the main window into the tray.
 *
 * This is where macOS becomes an accessory app (no Dock icon, no Cmd+Tab entry,
 * no menu bar of its own) — not the settings sync, which cannot know whether
 * the window is actually gone. The policy is applied only after the hide has
 * resolved, so a hide that throws leaves the app Regular and reachable; the
 * matching switch back to Regular happens in Rust's `show_main`, before any
 * path puts the window back on screen.
 *
 * The command is a no-op off macOS, so this stays platform-agnostic.
 */
export async function hideMainWindowToTray(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    try {
        await window.setSkipTaskbar(true);
    } catch (error) {
        void logError(error, { scope: 'window', step: 'setSkipTaskbar' });
    }
    await window.hide();
    // The window is already gone by here, so a failed policy switch is logged
    // rather than propagated: the caller's hide did succeed.
    await invokeNative('set_macos_activation_policy', { accessory: true }).catch((error) => {
        void logError(error, { scope: 'window', step: 'setActivationPolicy' });
    });
}
