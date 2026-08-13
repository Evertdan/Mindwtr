import { useCallback } from 'react';
import {
    taskDraftToUpdatePatch,
    type Attachment,
    type StoreActionResult,
    type Task,
    type TaskDraft,
    type TaskStatus,
} from '@mindwtr/core';

type UseTaskItemSubmitParams = {
    draft: TaskDraft;
    editAttachments: Attachment[] | undefined;
    editingTaskId: string | null;
    setEditingTaskId: (id: string | null) => void;
    setIsEditing: (value: boolean) => void;
    showToast: (message: string, tone?: 'info' | 'error' | 'success') => void;
    t: (key: string) => string;
    task: Task;
    updateTask: (id: string, patch: Partial<Task>) => Promise<StoreActionResult>;
};

type TaskItemSubmitOptions = {
    statusOverride?: TaskStatus;
    completedAtOverride?: string;
    timeSpentMinutesOverride?: number;
};

export function useTaskItemSubmit({
    draft,
    editAttachments,
    editingTaskId,
    setEditingTaskId,
    setIsEditing,
    showToast,
    t,
    task,
    updateTask,
}: UseTaskItemSubmitParams) {
    return useCallback(async (event?: React.FormEvent, options?: TaskItemSubmitOptions) => {
        event?.preventDefault();
        const patch = taskDraftToUpdatePatch(draft, task, {
            statusOverride: options?.statusOverride,
            attachments: editAttachments,
        });
        if (!patch) return;
        if (options?.completedAtOverride !== undefined) {
            patch.completedAt = options.completedAtOverride;
        }
        // Presence check, not `!== undefined`: an explicit undefined override
        // means "the time-spent field was shown but left blank," which clears
        // timeSpentMinutes rather than leaving it untouched (mirrors mobile's
        // completed-at-picker.tsx / #896).
        if (options && 'timeSpentMinutesOverride' in options) {
            patch.timeSpentMinutes = options.timeSpentMinutesOverride;
        }

        const result = await updateTask(task.id, patch);
        if (!result.success) {
            showToast(result.error || t('task.updateFailed'), 'error');
            return result;
        }
        setIsEditing(false);
        if (editingTaskId === task.id) {
            setEditingTaskId(null);
        }
        return result;
    }, [
        draft,
        editAttachments,
        editingTaskId,
        setEditingTaskId,
        setIsEditing,
        showToast,
        task,
        updateTask,
    ]);
}
