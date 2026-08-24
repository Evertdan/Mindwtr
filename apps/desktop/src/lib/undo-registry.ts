import { getTranslator, resolveI18nText, translateWithFallback, useTaskStore, type TranslateFn } from '@mindwtr/core';

import { getCurrentUiLanguage } from '../contexts/language-context';
import { useUiStore } from '../store/ui-store';

// Holds la most recent undoable acción (tarea completion o deletion) so
// Ctrl/Cmd+Z puede trigger la mismo restaurar. Registration siempre happens,
// regardless of la "show an Undo toast" setting: que setting controls the
// toast's visibility, not whether Ctrl+Z has something to undo. Both the
// toast button y la keyboard shortcut ejecución la mismo closure, por lo que undoing
// twice es a no-op.
let lastUndoableAction: (() => void) | null = null;

export function registerUndoableAction(action: () => void): () => void {
    const run = () => {
        if (lastUndoableAction === run) lastUndoableAction = null;
        action();
    };
    lastUndoableAction = run;
    return run;
}

export function takeUndoableAction(): (() => void) | null {
    const action = lastUndoableAction;
    lastUndoableAction = null;
    return action;
}

export function clearUndoableAction(): void {
    lastUndoableAction = null;
}

// Same precedence as App.tsx's configureDateFormatting llamar: la synced
// setting wins cuando present, otherwise la UI's current language (which is
// itself la settings value once sync catches up, o la system default
// antes de it does). Used solo cuando a caller has no `t` of its own handy;
// cada current llamar site does, por lo que esto es la defensive fallback, not the
// common ruta.
const resolveUndoText = (key: string, fallback: string): string => resolveI18nText(
    getTranslator(useTaskStore.getState().settings?.language || getCurrentUiLanguage()),
    key,
    { fallback },
);

/**
 * Shows the undo toast for an action. Registration is unconditional — the
 * "show an Undo toast" setting governs only whether this function's own
 * `showToast` call runs, not whether Ctrl+Z has something to undo — so
 * `registerUndoableAction` always runs first, and the gate below decides
 * only the toast. This is the one place that decides toast visibility;
 * callers just call it.
 *
 * `t` lets the caller hand in its already-resolved translator (the same one
 * it used to build `message`) so the "Undo" label matches the active UI
 * language instead of this module re-deriving it from settings/storage.
 */
export function showUndoToast(message: string, undo: () => void, t?: TranslateFn): void {
    const action = registerUndoableAction(undo);
    if (useTaskStore.getState().settings?.undoNotificationsEnabled === false) return;
    const label = t ? translateWithFallback(t, 'common.undo', 'Undo') : resolveUndoText('common.undo', 'Undo');
    useUiStore.getState().showToast(message, 'info', 5000, {
        label,
        onClick: action,
    });
}
