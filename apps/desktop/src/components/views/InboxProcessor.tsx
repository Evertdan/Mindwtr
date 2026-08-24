import { useState } from 'react';
import { Lightbulb, Play, X } from 'lucide-react';
import type { AppData, Area, Project, StoreActionResult, Task } from '@mindwtr/core';

import {
    dismissDesktopOnboardingHint,
    isDesktopOnboardingHintDismissed,
    shouldShowInboxProjectHint,
} from '../../lib/desktop-onboarding-events';
import { InboxProcessingQuickPanel } from '../InboxProcessingQuickPanel';
import { InboxProcessingWizard } from '../InboxProcessingWizard';
import { MindSweepLauncher, MindSweepTrigger } from '../MindSweepModal';
import { useInboxProcessingController } from './inbox/useInboxProcessingController';

type InboxProcessorProps = {
    t: (key: string) => string;
    isInbox: boolean;
    tasks: Task[];
    projects: Project[];
    areas: Area[];
    settings?: AppData['settings'];
    addTask: (title: string, initialProps?: Partial<Task>) => Promise<StoreActionResult>;
    addProject: (title: string, color: string, initialProps?: Partial<Project>) => Promise<Project | null>;
    updateTask: (id: string, updates: Partial<Task>) => Promise<StoreActionResult>;
    deleteTask: (id: string) => Promise<StoreActionResult>;
    allContexts: string[];
    allTags: string[];
    isProcessing: boolean;
    setIsProcessing: (value: boolean) => void;
    onOpenMindSweep?: () => void;
};

export function InboxProcessor({
    t,
    isInbox,
    tasks,
    projects,
    areas,
    settings,
    addTask,
    addProject,
    updateTask,
    deleteTask,
    allContexts,
    allTags,
    isProcessing,
    setIsProcessing,
    onOpenMindSweep,
}: InboxProcessorProps) {
    // Points at la step nuevo users miss: la capture que needs several actions
    // becomes a project inside procesar Inbox. Retires itself once they tienen a
    // project, por lo que it nunca nags anyone who already knows (#592).
    const [projectHintDismissed, setProjectHintDismissed] = useState(
        () => isDesktopOnboardingHintDismissed('inbox-project')
    );
    const showProjectHint = shouldShowInboxProjectHint(projectHintDismissed, projects.length);

    const {
        inboxCount,
        quickPanelProps,
        showStartButton,
        startProcessing,
        wizardProps,
    } = useInboxProcessingController({
        t,
        tasks,
        projects,
        areas,
        settings,
        addProject,
        addTask,
        updateTask,
        deleteTask,
        allContexts,
        allTags,
        isProcessing,
        setIsProcessing,
    });

    if (!isInbox) return null;

    return (
        <>
            {showStartButton && showProjectHint && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <p className="flex-1">{t('inbox.projectHint')}</p>
                    <button
                        type="button"
                        onClick={() => {
                            dismissDesktopOnboardingHint('inbox-project');
                            setProjectHintDismissed(true);
                        }}
                        className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
                        aria-label={t('common.dismiss')}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {showStartButton && (
                <div className="flex flex-wrap items-stretch gap-2">
                    <button
                        onClick={startProcessing}
                        className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 rounded-lg"
                    >
                        <Play className="w-4 h-4" />
                        {t('process.btn')} ({inboxCount})
                    </button>
                    {onOpenMindSweep ? (
                        <MindSweepTrigger t={t} onOpen={onOpenMindSweep} variant="secondary" />
                    ) : (
                        <MindSweepLauncher t={t} addTask={addTask} variant="secondary" />
                    )}
                </div>
            )}

            {quickPanelProps ? (
                <InboxProcessingQuickPanel {...quickPanelProps} />
            ) : (
                <InboxProcessingWizard
                    key={wizardProps.processingTask?.id ?? 'idle'}
                    {...wizardProps}
                />
            )}
        </>
    );
}
