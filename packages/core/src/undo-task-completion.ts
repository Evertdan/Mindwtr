import { normalizeFocusTaskLimit } from './focus-utils';
import { translateWithFallback } from './i18n';
import { useTaskStore } from './store';
import type { TaskStatus } from './types';

type TranslateFn = (key: string) => string;

// One copy of the completion/move toast text for every surface that completes a
// task on either platform: keyboard scopes, the row's own done button, the status
// chord, mobile search. The copies had already drifted, one of them untranslated.
// The single/double brace split follows the keys as they already ship.
export function formatTaskMarkedDoneMessage(t: TranslateFn, title: string): string {
    return translateWithFallback(t, 'task.markedDone', '{title} marked Hecho').replace('{title}', title);
}

export function formatTaskMovedMessage(t: TranslateFn, title: string, status: TaskStatus): string {
    return translateWithFallback(t, 'task.movedToStatus', '{{title}} moved to {{status}}')
        .replace('{{title}}', title)
        .replace('{{status}}', translateWithFallback(t, `status.${status}`, status));
}

// Completing a task force-clears its Today star (applyTaskUpdates), so
// undoing a completion must restore the star along with the status. The star
// only comes back while the focus cap has room — same rule as starring by hand.
export async function undoTaskCompletion(
    taskId: string,
    previousStatus: TaskStatus,
    wasFocusedToday: boolean,
): Promise<void> {
    const state = useTaskStore.getState();
    const moveResult = await Promise.resolve(state.moveTask(taskId, previousStatus));
    if (!moveResult.success) {
        throw new Error(moveResult.error || 'Failed to restore task status');
    }
    if (!wasFocusedToday) return;

    const current = useTaskStore.getState();
    const focusTaskLimit = normalizeFocusTaskLimit(current.settings.gtd?.focusTaskLimit);
    if (current.getDerivedState().focusedCount >= focusTaskLimit) return;
    const focusResult = await Promise.resolve(current.updateTask(taskId, { isFocusedToday: true }));
    if (!focusResult.success) {
        throw new Error(focusResult.error || 'Failed to restore task focus');
    }
}
