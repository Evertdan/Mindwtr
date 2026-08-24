import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_RESTORE_WINDOW_MS } from '@mindwtr/core';

const memoryStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => memoryStore.get(key) ?? null,
        setItem: async (key: string, value: string) => { memoryStore.set(key, value); },
        removeItem: async (key: string) => { memoryStore.delete(key); },
    },
}));

import { persistLastRoute, readRestorableRoute, setSessionRestoreOpenProject } from './session-restore';

describe('mobile session restore', () => {
    beforeEach(() => {
        memoryStore.clear();
        setSessionRestoreOpenProject(null);
    });

    it('round-trips a restorable route within the window', async () => {
        await persistLastRoute('/projects-screen', { projectId: 'project-1' });
        expect(await readRestorableRoute()).toEqual({
            pathname: '/projects-screen',
            params: { projectId: 'project-1' },
        });
    });

    it('drops params outside the project context and off the projects screen', async () => {
        await persistLastRoute('/projects-screen', { projectId: 'project-1', openToken: 'x' } as never);
        expect(await readRestorableRoute()).toEqual({
            pathname: '/projects-screen',
            params: { projectId: 'project-1' },
        });
        await persistLastRoute('/inbox', { projectId: 'project-1' });
        expect(await readRestorableRoute()).toEqual({ pathname: '/inbox' });
    });

    it('expires after the restore window', async () => {
        await persistLastRoute('/board');
        expect(await readRestorableRoute(Date.now() + SESSION_RESTORE_WINDOW_MS + 1000)).toBeNull();
    });

    it('keeps the previous snapshot when a transient route is persisted', async () => {
        await persistLastRoute('/contexts');
        await persistLastRoute('/capture-modal');
        expect(await readRestorableRoute()).toEqual({ pathname: '/contexts' });
        await persistLastRoute('/settings');
        expect(await readRestorableRoute()).toEqual({ pathname: '/contexts' });
    });

    it('carries the open project from the screen mirror when the route has no param', async () => {
        // Tocar una fila del proyecto la abre a través del componente Estado solo (#842) —
        // the mirrored id must land in the snapshot without a route param.
        setSessionRestoreOpenProject('project-2');
        await persistLastRoute('/projects-screen');
        expect(await readRestorableRoute()).toEqual({
            pathname: '/projects-screen',
            params: { projectId: 'project-2' },
        });

        // Fuera de las superficies de los proyectos, el espejo no debe filtrarse en instantáneas.
        await persistLastRoute('/focus');
        expect(await readRestorableRoute()).toEqual({ pathname: '/focus' });

        // Cerrar el proyecto limpia el espejo.
        setSessionRestoreOpenProject(null);
        await persistLastRoute('/projects-screen');
        expect(await readRestorableRoute()).toEqual({ pathname: '/projects-screen' });
    });

    it('restores saved search routes by prefix', async () => {
        await persistLastRoute('/saved-search/abc');
        expect(await readRestorableRoute()).toEqual({ pathname: '/saved-search/abc' });
    });

    it('ignores unknown routes and malformed payloads', async () => {
        memoryStore.set('mindwtr:session:lastRoute', JSON.stringify({ pathname: '/nope', at: Date.now() }));
        expect(await readRestorableRoute()).toBeNull();
        memoryStore.set('mindwtr:session:lastRoute', 'not json');
        expect(await readRestorableRoute()).toBeNull();
    });
});
