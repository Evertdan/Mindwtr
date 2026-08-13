import { getTranslator, resolveI18nText, useTaskStore } from '@mindwtr/core';

import { useUiStore } from '../store/ui-store';

// Holds the most recent undoable action (task completion or deletion) so
// Ctrl/Cmd+Z can trigger the same restore the undo toast offers. Registration
// is independent of whether the toast is shown, and both the toast button and
// the keyboard shortcut run the same closure, so undoing twice is a no-op.
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

const resolveUndoText = (key: string, fallback: string): string => resolveI18nText(
    getTranslator(useTaskStore.getState().settings?.language ?? 'en'),
    key,
    { fallback },
);

/**
 * Shows the undo toast for an action, registering `undo` first — unless undo
 * notifications are disabled, in which case NEITHER the toast NOR the
 * registry write happens. Checking the gate before any registry write (not
 * after) is deliberate: every call site used to hand-roll its own order, and
 * at least one (CalendarView) registered unconditionally and only gated the
 * toast, burning a registry slot with no toast to show for it. Folding the
 * gate in here makes that divergence impossible instead of just fixing the
 * one site that had it.
 */
export function showUndoToast(message: string, undo: () => void): void {
    if (useTaskStore.getState().settings?.undoNotificationsEnabled === false) return;
    const action = registerUndoableAction(undo);
    useUiStore.getState().showToast(message, 'info', 5000, {
        label: resolveUndoText('common.undo', 'Undo'),
        onClick: action,
    });
}
