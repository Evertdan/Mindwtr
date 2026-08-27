import { useCallback, useEffect, useMemo, useRef } from 'react';

import { isTaskActionable, useTaskStore } from '@mindwtr/core';

import { logInfo } from '@/lib/app-log';
import { setNotificationOpenHandler } from '@/lib/notification-service';
import { parseTdahActivityId } from '@/lib/tdah-activity-id';
import { consumePendingNotificationOpenPayload } from '@/modules/notification-open-intents';

// Outcome evidence for #1028: a received action that changes nothing must say
// why, or the Registro can't separate a lost tap from a deliberately ignored one.
const logNotificationOutcome = (message: string, extra: Record<string, string>) => {
    void logInfo(`[Local Notifications] ${message}`, { scope: 'notifications', extra });
};

type RouterLike = {
    push: (...args: any[]) => void;
};

type UseRootLayoutNotificationOpenHandlerParams = {
    appReady: boolean;
    pathname?: string | null;
    router: RouterLike;
};

function isReviewReminderKind(kind: string | undefined): boolean {
    return kind === 'task-review' || kind === 'project-review';
}

function isWeeklyReviewOpen(kind: string | undefined, notificationId: string): boolean {
    return kind === 'weekly-review' || notificationId === 'digest:weekly-review';
}

function isDailyReviewOpen(kind: string | undefined, notificationId: string): boolean {
    return kind === 'daily-digest' || notificationId === 'digest:morning' || notificationId === 'digest:evening';
}

// N-05 (story 2.1's persistent connection notification) opens MainActivity
// directly via a mindwtr:///tdah-today ACTION_VIEW intent, the same shape as
// the pre-existing persistent-capture notification — Expo Router resolves
// that URI to /tdah-today on its own, with no payload ever passed through
// this dispatcher. This 'tdah-connection' kind is kept here regardless (spec
// Code Map: "registrado como nuevo caso ... para el tap en N-05") so any
// future caller that does route a payload through
// consumePendingNotificationOpenPayload with this kind lands on T-01 too.
function isTdahConnectionOpen(kind: string | undefined): boolean {
    return kind === 'tdah-connection';
}

// Story 2.2 ("La vibra en la muñeca"): a tap on the Activity-trigger
// notification's Iniciar or Completada action (or its body). Story 2.3
// ("El registro en un toque") routes this straight to T-02
// (TdahActivityDetailScreen, view mode) with the tapped action as an
// `autoAction` route param — T-02 fires the matching
// `registerActivityAction` itself once mounted (guarded, single-shot). The
// Activity id rides in `context` rather than a new field: both the live
// OnNotificationOpened event and the Android cold-start payload store
// (apps/mobile/modules/notification-open-intents) only forward a fixed
// field allowlist with no `activityId` slot, and `context` is the one
// generic passthrough field that allowlist already carries end-to-end (see
// use-root-layout-tdah-connection.ts's handleTdahActivityTriggerEvent).
function isTdahActivityOpen(kind: string | undefined): boolean {
    return kind === 'tdah-activity';
}

// Story 3.1 ("La invitación nocturna"): a tap on N-03, the ritual-invitation
// notification. Routes straight to /tdah-ritual (T-05's placeholder route —
// the real scoreboard/decision-chips ship in Story 3.2); there is no
// payload to carry (spec Always: no per-instance data, unlike
// tdah-activity's `context`/`edge`), so this is a plain kind check.
function isTdahRitualOpen(kind: string | undefined): boolean {
    return kind === 'tdah-ritual';
}

export function useRootLayoutNotificationOpenHandler({
    appReady,
    pathname,
    router,
}: UseRootLayoutNotificationOpenHandlerParams) {
    const pendingPayloadRef = useRef<{
        notificationId?: string;
        actionIdentifier?: string;
        taskId?: string;
        projectId?: string;
        context?: string;
        kind?: string;
    } | null>(null);
    const handledCompleteActionsRef = useRef(new Set<string>());
    const taskOpenSequenceRef = useRef(0);
    const normalizedPathname = useMemo(() => String(pathname || '').trim(), [pathname]);
    const canNavigate = appReady && normalizedPathname.length > 0;

    const routeNotificationOpen = useCallback((payload: {
        notificationId?: string;
        actionIdentifier?: string;
        taskId?: string;
        projectId?: string;
        context?: string;
        kind?: string;
    }) => {
        const notificationId = typeof payload?.notificationId === 'string' ? payload.notificationId.trim() : undefined;
        const openToken = notificationId || String(Date.now());
        const actionIdentifier = typeof payload?.actionIdentifier === 'string' ? payload.actionIdentifier : undefined;
        const taskId = typeof payload?.taskId === 'string' ? payload.taskId : undefined;
        const projectId = typeof payload?.projectId === 'string' ? payload.projectId : undefined;
        const context = typeof payload?.context === 'string' ? payload.context : undefined;
        const kind = typeof payload?.kind === 'string' ? payload.kind : undefined;
        const normalizedAction = String(actionIdentifier || '').trim().toLowerCase();
        if (normalizedAction === 'dismiss' || normalizedAction === 'dismiss_action' || normalizedAction === 'snooze' || normalizedAction === 'snooze_action') {
            return;
        }
        if ((normalizedAction === 'complete' || normalizedAction === 'complete_action') && taskId) {
            const actionKey = `${openToken}:${taskId}:complete`;
            if (handledCompleteActionsRef.current.has(actionKey)) {
                logNotificationOutcome('Complete action ignored as duplicate', { taskId });
                return;
            }
            handledCompleteActionsRef.current.add(actionKey);

            const state = useTaskStore.getState();
            const task = state._tasksById?.get(taskId) ?? state.tasks?.find((item) => item.id === taskId);
            if (!task || task.deletedAt || !isTaskActionable(task)) {
                logNotificationOutcome('Complete action dropped', {
                    taskId,
                    reason: !task ? 'task-not-found' : task.deletedAt ? 'task-deleted' : 'not-actionable',
                });
                return;
            }
            logNotificationOutcome('Complete action applied', { taskId });
            state.updateTask(taskId, { status: 'done', isFocusedToday: false }).catch(() => undefined);
            return;
        }
        if (isReviewReminderKind(kind)) {
            router.push({
                pathname: '/review-tab',
                params: {
                    openToken,
                    ...(taskId ? { taskId } : {}),
                    ...(projectId ? { projectId } : {}),
                },
            });
            return;
        }
        if (taskId) {
            taskOpenSequenceRef.current += 1;
            const taskOpenToken = `${notificationId || 'notification'}:${Date.now()}:${taskOpenSequenceRef.current}`;
            useTaskStore.getState().setHighlightTask(taskId);
            router.push({ pathname: '/focus', params: { taskId, openToken: taskOpenToken, taskTab: 'view' } });
            return;
        }
        if (projectId) {
            router.push({ pathname: '/projects-screen', params: { projectId } });
            return;
        }
        if (kind === 'context-automation' && context) {
            router.push({ pathname: '/contexts', params: { token: context } });
            return;
        }
        if (isDailyReviewOpen(kind, openToken)) {
            router.push({ pathname: '/daily-review', params: { openToken } });
            return;
        }
        if (isWeeklyReviewOpen(kind, openToken)) {
            router.push({ pathname: '/weekly-review', params: { openToken } });
            return;
        }
        if (isTdahConnectionOpen(kind)) {
            router.push('/tdah-today');
            return;
        }
        if (isTdahActivityOpen(kind)) {
            const activityId = parseTdahActivityId(context);
            if (activityId === null) {
                router.push('/tdah-today');
                return;
            }
            router.push({
                pathname: `/tdah-activity/${activityId}`,
                params: {
                    ...(normalizedAction ? { autoAction: normalizedAction } : {}),
                },
            });
            return;
        }
        if (isTdahRitualOpen(kind)) {
            router.push('/tdah-ritual');
            return;
        }
    }, [router]);

    const handleNotificationOpen = useCallback((payload: {
        notificationId?: string;
        actionIdentifier?: string;
        taskId?: string;
        projectId?: string;
        context?: string;
        kind?: string;
    }) => {
        if (!canNavigate) {
            logNotificationOutcome('Notification action deferred until app is ready', {
                action: payload?.actionIdentifier || 'open',
                taskId: payload?.taskId || '',
            });
            pendingPayloadRef.current = payload;
            return;
        }
        routeNotificationOpen(payload);
    }, [canNavigate, routeNotificationOpen]);

    useEffect(() => {
        setNotificationOpenHandler(handleNotificationOpen);
        void consumePendingNotificationOpenPayload().then((payload) => {
            if (!payload) return;
            logNotificationOutcome('Cold-start notification payload consumed', {
                action: payload.actionIdentifier || 'open',
                taskId: payload.taskId || '',
            });
            handleNotificationOpen(payload);
        });
        return () => {
            setNotificationOpenHandler(null);
        };
    }, [handleNotificationOpen]);

    useEffect(() => {
        if (!canNavigate || !pendingPayloadRef.current) return;
        const pendingPayload = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        routeNotificationOpen(pendingPayload);
    }, [canNavigate, routeNotificationOpen]);
}
