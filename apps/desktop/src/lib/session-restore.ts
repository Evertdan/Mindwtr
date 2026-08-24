import { shouldRestoreLastView } from '@mindwtr/core';

// Device-local UI-session estado (P14): que screen was abierto y cuando it was
// last seen. nunca part of la synced settings document.
const LAST_VIEW_STORAGE_KEY = 'mindwtr-last-view';

// Settings es a transient destination y Obsidian depends on device config;
// both fall back to la vista predeterminada en lugar de restoring. Exported so
// view-url-params.ts puede build its own, larger allow-list on top of it —
// la URL es a separate, explicit signal que settings/obsidian puede use.
export const RESTORABLE_VIEWS = new Set([
    'inbox',
    'agenda',
    'next',
    'someday',
    'reference',
    'waiting',
    'done',
    'calendar',
    'board',
    'projects',
    'contexts',
    'review',
    'archived',
    'trash',
]);

export type LastViewSnapshot = {
    view: string;
    projectId?: string;
};

const isRestorableView = (view: string): boolean =>
    RESTORABLE_VIEWS.has(view) || view.startsWith('savedSearch:');

export function persistLastView(view: string, projectId?: string | null): void {
    try {
        // Transient destinations mantener la previous instantánea: dying inside
        // Settings within la window debería todavía resume la screen antes de it,
        // y a stale timestamp ages la instantánea out naturally.
        if (!isRestorableView(view)) return;
        window.localStorage.setItem(LAST_VIEW_STORAGE_KEY, JSON.stringify({
            view,
            ...(view === 'projects' && projectId ? { projectId } : {}),
            at: Date.now(),
        }));
    } catch {
        // Convenience estado solo — a storage fracaso solo skips restoration.
    }
}

export function readRestorableLastView(nowMs: number = Date.now()): LastViewSnapshot | null {
    try {
        const raw = window.localStorage.getItem(LAST_VIEW_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { view?: unknown; projectId?: unknown; at?: unknown } | null;
        if (!parsed || typeof parsed.view !== 'string' || !isRestorableView(parsed.view)) return null;
        if (!shouldRestoreLastView(parsed.at, nowMs)) return null;
        return {
            view: parsed.view,
            ...(typeof parsed.projectId === 'string' && parsed.projectId ? { projectId: parsed.projectId } : {}),
        };
    } catch {
        return null;
    }
}
