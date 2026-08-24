import { format } from 'date-fns';
import { Check, Search, X } from 'lucide-react';
import { CALENDAR_TIME_ESTIMATE_OPTIONS, formatCalendarDurationLabel, safeParseDate, tFallback } from '@mindwtr/core';

import { TaskInput } from '../../Task/TaskInput';
import { TaskItem } from '../../TaskItem';
import { Dialog, DialogBody } from '../../ui/Dialog';
import { DateField } from '../../ui/DateField';
import { QuickAddSyntaxHint } from '../../ui/QuickAddSyntaxHint';
import { cn } from '../../../lib/utils';
import { useNativeDateInputLocale } from '../../../hooks/use-native-date-input-locale';
import { DESKTOP_GRID_SNAP_MINUTES, combineDateAndTime } from './calendar-primitives';
import type { DesktopCalendarController } from './useDesktopCalendarController';

type CalendarOpenTaskModalController = Pick<
    DesktopCalendarController,
    | 'closeOpenTask'
    | 'openProject'
    | 'openTask'
    | 't'
>;

type CalendarTaskComposerModalController = Pick<
    DesktopCalendarController,
    | 'areas'
    | 'closeTaskComposer'
    | 'projects'
    | 'quickAddSuggestionTokens'
    | 'resolveText'
    | 'saveTaskComposer'
    | 'selectTaskComposerTask'
    | 'selectedComposerTask'
    | 'taskComposer'
    | 'taskComposerCandidates'
    | 'taskComposerError'
    | 't'
    | 'updateTaskComposerDuration'
    | 'updateTaskComposerEndTime'
    | 'updateTaskComposerMode'
    | 'updateTaskComposerQuery'
    | 'updateTaskComposerStart'
    | 'updateTaskComposerTitle'
>;

type CalendarOpenTaskModalProps = {
    controller: CalendarOpenTaskModalController;
};

type CalendarTaskComposerModalProps = {
    controller: CalendarTaskComposerModalController;
};

export function CalendarOpenTaskModal({ controller }: CalendarOpenTaskModalProps) {
    const {
        closeOpenTask,
        openProject,
        openTask,
        t,
    } = controller;

    if (!openTask) return null;

    return (
        // my-auto centres the panel when there is room and collapses to zero
        // when the editor is taller than the viewport, so a long tarea nunca has
        // its top cut off — which plain items-center sería do. The scrim itself
        // scrolls here rather than the panel.
        <Dialog
            onClose={closeOpenTask}
            label={tFallback(t, 'taskEdit.editTask', 'Task')}
            placement="top"
            overlayClassName="overflow-y-auto p-4"
            panelClassName="my-auto max-w-3xl max-h-[none] bg-background rounded-xl border-border shadow-xl p-4"
        >
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">{tFallback(t, 'taskEdit.editTask', 'Task')}</h3>
                <button
                    type="button"
                    onClick={closeOpenTask}
                    className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                >
                    {t('common.close')}
                </button>
            </div>
            <TaskItem
                task={openTask}
                project={openProject}
                showQuickDone={false}
                readOnly={false}
                compactMetaEnabled={true}
                editorPresentation="inline"
            />
        </Dialog>
    );
}

export function CalendarTaskComposerModal({ controller }: CalendarTaskComposerModalProps) {
    const {
        areas,
        closeTaskComposer,
        projects,
        quickAddSuggestionTokens,
        resolveText,
        saveTaskComposer,
        selectTaskComposerTask,
        selectedComposerTask,
        taskComposer,
        taskComposerCandidates,
        taskComposerError,
        t,
        updateTaskComposerDuration,
        updateTaskComposerEndTime,
        updateTaskComposerMode,
        updateTaskComposerQuery,
        updateTaskComposerStart,
        updateTaskComposerTitle,
    } = controller;
    const { nativeDateInputLocale, dateFormatSetting } = useNativeDateInputLocale();
    const dateLabel = resolveText('calendar.date', 'Date');

    if (!taskComposer) return null;

    return (
        <Dialog
            onClose={closeTaskComposer}
            label={resolveText('calendar.addToCalendar', 'Add to calendar')}
            placement="top"
            overlayClassName="p-4"
            // Capped under the 10vh offset so the date/time grid puede nunca empujar
            // Save off a short window (#957).
            panelClassName="mt-[10vh] max-w-xl max-h-[80vh] border-border"
        >
            <form
                className="flex min-h-0 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    void saveTaskComposer();
                }}
            >
                <div className="shrink-0 flex items-center justify-between border-b border-border px-4 py-3">
                    <div>
                        <h3 className="text-base font-semibold">{resolveText('calendar.addToCalendar', 'Add to calendar')}</h3>
                        <p className="text-xs text-muted-foreground">
                            {format(combineDateAndTime(taskComposer.startDateValue, taskComposer.startTimeValue) ?? new Date(), 'EEE, MMM d')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={closeTaskComposer}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={t('common.close')}
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
                <DialogBody className="space-y-4 p-4">
                    <div className="inline-flex rounded-md border border-border bg-muted/40 p-1">
                        <button
                            type="button"
                            onClick={() => updateTaskComposerMode('new')}
                            className={cn(
                                "h-8 rounded px-3 text-xs font-medium transition-colors",
                                taskComposer.mode === 'new'
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            {resolveText('calendar.newTask', 'New task')}
                        </button>
                        <button
                            type="button"
                            onClick={() => updateTaskComposerMode('existing')}
                            className={cn(
                                "h-8 rounded px-3 text-xs font-medium transition-colors",
                                taskComposer.mode === 'existing'
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            {resolveText('calendar.existingTask', 'Existing task')}
                        </button>
                    </div>

                    {taskComposer.mode === 'new' ? (
                        <div className="space-y-1">
                            <label className="block text-sm font-medium" htmlFor="calendar-task-composer-title">
                                {resolveText('calendar.taskTitle', 'Task title')}
                            </label>
                            <TaskInput
                                id="calendar-task-composer-title"
                                autoFocus
                                value={taskComposer.title}
                                onChange={updateTaskComposerTitle}
                                projects={projects}
                                contexts={quickAddSuggestionTokens}
                                areas={areas}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-primary/30"
                                placeholder={t('calendar.addTask')}
                            />
                            <p className="text-xs font-normal text-muted-foreground">
                                <QuickAddSyntaxHint text={t('quickAdd.help')} />
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <label className="block space-y-1 text-sm font-medium">
                                {resolveText('calendar.findTask', 'Find task')}
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                                    <input
                                        autoFocus
                                        type="text"
                                        value={taskComposer.query}
                                        onChange={(event) => updateTaskComposerQuery(event.target.value)}
                                        className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-primary/30"
                                        placeholder={t('calendar.schedulePlaceholder')}
                                    />
                                </div>
                            </label>
                            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-background/60 p-1">
                                {taskComposerCandidates.map((task) => {
                                    const selected = task.id === taskComposer.selectedTaskId;
                                    return (
                                        <button
                                            key={task.id}
                                            type="button"
                                            onClick={() => selectTaskComposerTask(task)}
                                            className={cn(
                                                "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm",
                                                selected ? "bg-primary/10 text-primary" : "hover:bg-muted"
                                            )}
                                        >
                                            <span className="min-w-0 flex-1 truncate">{task.title}</span>
                                            {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                                        </button>
                                    );
                                })}
                                {taskComposerCandidates.length === 0 && (
                                    <div className="px-2 py-3 text-sm text-muted-foreground">
                                        {resolveText('calendar.noMatchingTasks', 'No matching tasks')}
                                    </div>
                                )}
                            </div>
                            {selectedComposerTask && (
                                <div className="truncate rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                                    {selectedComposerTask.title}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-4">
                        {/* Not a <label> wrapper: it would swallow clicks meant for
                            DateField's calendar button. */}
                        <div className="space-y-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                            {dateLabel}
                            <DateField
                                t={t}
                                dateAriaLabel={dateLabel}
                                dateValue={taskComposer.startDateValue}
                                selectedDate={safeParseDate(taskComposer.startDateValue)}
                                dateFormatSetting={dateFormatSetting}
                                nativeDateInputLocale={nativeDateInputLocale}
                                dateInputClassName="h-10 rounded-md border border-border bg-background px-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                                className="max-w-none"
                                onDateChange={(value) => updateTaskComposerStart({ startDateValue: value })}
                            />
                        </div>
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                            {resolveText('calendar.start', 'Start')}
                            <input
                                type="time"
                                step={DESKTOP_GRID_SNAP_MINUTES * 60}
                                value={taskComposer.startTimeValue}
                                onChange={(event) => updateTaskComposerStart({ startTimeValue: event.target.value })}
                                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                            {resolveText('calendar.end', 'End')}
                            <input
                                type="time"
                                step={DESKTOP_GRID_SNAP_MINUTES * 60}
                                value={taskComposer.endTimeValue}
                                onChange={(event) => updateTaskComposerEndTime(event.target.value)}
                                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                        </label>
                        <label className="space-y-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                            {resolveText('calendar.duration', 'Duration')}
                            <select
                                value={taskComposer.durationMinutes}
                                onChange={(event) => updateTaskComposerDuration(Number(event.target.value))}
                                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                                {CALENDAR_TIME_ESTIMATE_OPTIONS.map((option) => (
                                    <option key={option.estimate} value={option.minutes}>
                                        {formatCalendarDurationLabel(option.minutes)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {taskComposerError && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {taskComposerError}
                        </div>
                    )}
                </DialogBody>
                <div className="shrink-0 flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                    <button
                        type="button"
                        onClick={closeTaskComposer}
                        className="h-9 rounded-md bg-muted px-3 text-sm font-medium hover:bg-muted/80"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={taskComposer.mode === 'new' ? !taskComposer.title.trim() : !taskComposer.selectedTaskId}
                        className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {t('common.save')}
                    </button>
                </div>
            </form>
        </Dialog>
    );
}
