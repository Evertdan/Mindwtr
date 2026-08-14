import { router } from 'expo-router';

type TaskOpenTab = 'view' | 'task';

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
         * Swap the current route for the task screen instead of stacking on
         * top of it. The capture route's "Save & edit" needs this: a push
         * leaves the filled capture form underneath, so backing out of the
         * editor lands on it again (#1029).
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
        router.replace(target);
        return;
    }
    router.push(target);
}
