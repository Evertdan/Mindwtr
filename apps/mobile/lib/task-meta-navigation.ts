import { router } from 'expo-router';

type TaskOpenTab = 'view' | 'task';

type PendingCaptureTaskOpen = { taskId: string; projectId: string; taskTab: TaskOpenTab };

// Save & edit from a project's own capture cannot navigate at all: any
// navigation to /projects-screen while it is already the screen underneath
// stacks a duplicate of it, costing an extra back tap through an identical
// page (#1029, the #938 trap). Instead the capture route stashes the editor
// request here and simply pops; the project screen consumes it on refocus.
let pendingCaptureTaskOpen: PendingCaptureTaskOpen | null = null;

export function stashPendingCaptureTaskOpen(pending: PendingCaptureTaskOpen) {
    pendingCaptureTaskOpen = pending;
}

export function consumePendingCaptureTaskOpen(projectId: string | undefined): PendingCaptureTaskOpen | null {
    const pending = pendingCaptureTaskOpen;
    if (!pending || !projectId || pending.projectId !== projectId) return null;
    pendingCaptureTaskOpen = null;
    return pending;
}

const navigateToTaskMetaScreen = (
    pathname: '/projects-screen' | '/contexts',
    params: { projectId?: string; token?: string; openToken?: string }
) => {
    // Use public NAVIGATE semantics so repeated same-screen taps update params
    // without building an unbounded back stack.
    router.navigate({ pathname, params });
};

export function openProjectScreen(projectId: string) {
    if (!projectId) return;
    // Each explicit open mints a token: navigate() reuses the mounted screen
    // instance, and without a fresh token the screen cannot tell "the user
    // asked for this project again" from its own stale route param.
    navigateToTaskMetaScreen('/projects-screen', { projectId, openToken: String(Date.now()) });
}

export function openContextsScreen(token: string) {
    if (!token) return;
    navigateToTaskMetaScreen('/contexts', { token });
}

export function openTaskScreen(
    taskId: string,
    projectId?: string,
    taskTab: TaskOpenTab = 'view',
    options?: {
        /**
         * Leave the current route and open the task on the target screen.
         * The capture route's "Save & edit" needs this: a push leaves the
         * filled capture form underneath, so backing out of the editor lands
         * on it again (#1029). Only for targets that are NOT the screen
         * directly underneath — for those, use the pending-capture-task-open
         * stash instead (navigating to an already-top screen stacks a
         * duplicate of it, the #938 trap).
         */
        replace?: boolean;
    },
) {
    if (!taskId) return;
    const openToken = String(Date.now());
    const target = projectId
        ? { pathname: '/projects-screen' as const, params: { projectId, taskId, openToken, taskTab } }
        : { pathname: '/focus' as const, params: { taskId, openToken, taskTab } };
    if (options?.replace) {
        if (router.canGoBack()) {
            router.back();
            router.navigate(target);
        } else {
            // Nothing behind this route (restored session straight into
            // capture): swapping in place is the only option.
            router.replace(target);
        }
        return;
    }
    router.push(target);
}
