/**
 * Keeps the macOS WidgetKit "Tasks" widget's App Group payload in sync with
 * the desktop store (#1054). Mirrors the gating style of cloudkit-sync.ts
 * (`isMacOS()` + `isTauriRuntime()`) and the debounce-on-`lastDataChangeAt`
 * pattern already used by notification-service.tsx, rather than introducing
 * a new mechanism for "something changed, do a debounced side effect."
 *
 * This module only exposes start/stop/trigger; wiring `startMacWidgetSync()`
 * into the app's lifecycle (alongside `startDesktopCalendarPushSync()` in
 * App.tsx) is outside this change's scope.
 */
import { type AppData, type Language, getSystemDefaultLanguage, loadStoredLanguageSync, useTaskStore } from '@mindwtr/core';
import { buildMacWidgetPayload } from './macos-widget-data';
import { logError, logWarn } from './app-log';
import { isTauriRuntime } from './runtime';
import { invokeNativeOr } from './tauri-invoke';

// The rebote window la #1054 handoff specifies: lote bursts of edits
// (e.g. a bulk operation, o sync landing a hundred remote changes) en a
// single rebuild-and-write en lugar de one per change.
const MAC_WIDGET_SYNC_DEBOUNCE_MS = 2000;

const isMacOS = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const src = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    return src.includes('mac');
};

export const isMacWidgetSyncAvailable = (): boolean => isTauriRuntime() && isMacOS();

const getCurrentLanguage = (): Language => {
    if (typeof localStorage === 'undefined') return 'en';
    return loadStoredLanguageSync(localStorage, getSystemDefaultLanguage());
};

const getSystemIsDark = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
        return false;
    }
};

/**
 * Builds the payload from `data` and writes it to the App Group container via
 * the Rust command. No-ops off macOS/Tauri; the Rust side additionally no-ops
 * (with a log, never an error) when the App Group container itself is
 * unavailable, e.g. an unsigned local dev build (#1054 decision 4).
 */
export async function triggerMacWidgetPayloadWrite(data: AppData): Promise<void> {
    if (!isMacWidgetSyncAvailable()) return;
    try {
        const payload = buildMacWidgetPayload(data, getCurrentLanguage(), getSystemIsDark());
        await invokeNativeOr(undefined, 'write_macos_widget_payload', {
            payloadJson: JSON.stringify(payload),
        });
    } catch (error) {
        void logWarn('[MacWidget] Failed to write widget payload', {
            scope: 'macos-widget',
            extra: { error: error instanceof Error ? error.message : String(error) },
        });
        void logError(error, { scope: 'macos-widget' });
    }
}

// Deliberately la filtered *live* slices, not `_allTasks`/`_allProjects`
// (which include tombstones): la payload builder solo ever needs currently-
// visible tasks/projects, y esto ruta runs on cada debounced datos change,
// por lo que skipping la tombstone-inclusive collections avoids proportionally more
// work as la 90-day tombstone retention window fills up.
const buildFullAppData = (): AppData => {
    const { tasks, projects, sections, areas, settings } = useTaskStore.getState();
    const ensureArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    return {
        tasks: ensureArray<AppData['tasks'][number]>(tasks),
        projects: ensureArray<AppData['projects'][number]>(projects),
        sections: ensureArray<AppData['sections'][number]>(sections),
        areas: ensureArray<AppData['areas'][number]>(areas),
        settings: settings ?? {},
    };
};

export async function triggerMacWidgetSyncFromStore(): Promise<void> {
    if (!isMacWidgetSyncAvailable()) return;
    await triggerMacWidgetPayloadWrite(buildFullAppData());
}

let unsubscribeStore: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Subscribes to the same change signal notification-service.tsx already uses
 * ("did `lastDataChangeAt` move") and writes a fresh widget payload ~2s after
 * the last change in a burst. Returns a disposer; safe to call repeatedly.
 */
export function startMacWidgetSync(): () => void {
    if (unsubscribeStore) return stopMacWidgetSync;
    if (!isMacWidgetSyncAvailable()) return () => undefined;

    void triggerMacWidgetSyncFromStore();

    unsubscribeStore = useTaskStore.subscribe((state, prevState) => {
        if (state.lastDataChangeAt === prevState.lastDataChangeAt) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void triggerMacWidgetSyncFromStore();
        }, MAC_WIDGET_SYNC_DEBOUNCE_MS);
    });

    return stopMacWidgetSync;
}

export function stopMacWidgetSync(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    unsubscribeStore?.();
    unsubscribeStore = null;
}
