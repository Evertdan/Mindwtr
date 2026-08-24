import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useTaskStore } from '@mindwtr/core';

import { logError } from '@/lib/app-log';
import { ingestPendingCaptures } from '@/lib/pending-captures';

// Drena las capturas de Atajos en segundo plano (#845) en la tienda al inicio y
// on every return to the foreground; the queue directory is empty on every
// platform and flow that never enqueues, so Esto es a single stat call.
export function useRootLayoutPendingCaptures({ dataReady }: { dataReady: boolean }) {
    const runningRef = useRef(false);

    const drainQueue = useCallback(async () => {
        if (runningRef.current) return;
        runningRef.current = true;
        try {
            const { addTask, addProject, projects, areas, tasks, people, settings } = useTaskStore.getState();
            await ingestPendingCaptures({ addTask, addProject, projects, areas, tasks, people, settings });
        } catch (error) {
            void logError(error, { scope: 'shortcuts', extra: { message: 'Pending capture ingest failed' } });
        } finally {
            runningRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!dataReady) return;
        void drainQueue();
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') void drainQueue();
        });
        return () => subscription.remove();
    }, [dataReady, drainQueue]);
}
