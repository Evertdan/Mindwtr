import { useEffect } from 'react';
import { logError } from './app-log';
import { isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';
import type { DesktopCloseBehavior } from './window-behavior';

export type DesktopShellSyncOptions = {
    /** `undefined` until settings hydrate — the tray is left alone until then. */
    showTray: boolean | undefined;
    trayTooltip: string;
    closeBehavior: DesktopCloseBehavior;
};

/**
 * Fires one shell command and reports failures under `scope`/`step` — the
 * strings field logs are grepped by, so they are part of the contract.
 *
 * Returns the effect cleanup. A command that settles after the effect is torn
 * down no longer logs; the send itself is not recalled, which only matters
 * during teardown or a superseded value, and later sends still land in order.
 */
function runShellCommand(
    command: string,
    args: Record<string, unknown>,
    scope: string,
    step: string,
): () => void {
    let cancelled = false;
    void invokeNative(command, args).catch((error) => {
        if (cancelled) return;
        void logError(error, { scope, step });
    });
    return () => {
        cancelled = true;
    };
}

/**
 * Mirrors settings out to the OS shell: tray icon, tray tooltip, macOS dock.
 *
 * One effect per command on purpose — each re-runs on its own inputs, and the
 * tray icon must exist before its tooltip is set.
 */
export function useDesktopShellSync({ showTray, trayTooltip, closeBehavior }: DesktopShellSyncOptions): void {
    useEffect(() => {
        if (!isTauriRuntime()) return;
        if (showTray === undefined) return;
        return runShellCommand('set_tray_visible', { visible: showTray !== false }, 'tray', 'setVisible');
    }, [showTray]);

    // Hovering la tray icon showed an empty rectangle because no tooltip was
    // ever establecer. Fill it con today's enfoque por lo que la list puede be glanced at without
    // opening la window (#935). Linux ignores esto natively — Tauri does not
    // support tray tooltips ahí — por lo que la command es a no-op on que platform.
    useEffect(() => {
        if (!isTauriRuntime()) return;
        if (showTray === false) return;
        return runShellCommand('set_tray_tooltip', { tooltip: trayTooltip }, 'tray', 'setTooltip');
    }, [showTray, trayTooltip]);

    // Settings alone puede solo ever put la app *back* in la Dock, Cmd+Tab and
    // la menu bar. Enabling close-to-tray used to hace it an accessory app for
    // la rest of la session, window on screen o not; becoming an accessory
    // belongs to la hide ruta (hide-to-tray.ts) y es undone by la mostrar ruta
    // (Rust `show_main`), la solo two places que know donde la window es.
    // Restoring Regular here todavía matters: a window already hidden in la tray
    // cuando close-to-tray o la tray icon es turned off (a settings sync from
    // another device puede do esto) sería otherwise be left con no Dock icon and
    // no tray to come back through.
    useEffect(() => {
        if (!isTauriRuntime()) return;
        if (closeBehavior === 'tray' && showTray !== false) return;
        return runShellCommand(
            'set_macos_activation_policy',
            { accessory: false },
            'window',
            'setActivationPolicy',
        );
    }, [closeBehavior, showTray]);
}
