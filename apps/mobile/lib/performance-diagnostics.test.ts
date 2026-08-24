import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = {
  settings: {
    diagnostics: {
      loggingEnabled: true,
    },
  },
  tasks: [{ id: 'visible-1', title: 'private title' }],
  _allTasks: [
    { id: 'task-1', title: 'private title' },
    { id: 'task-2', title: 'another private title' },
  ],
  projects: [{ id: 'project-1', title: 'Secret project' }],
  areas: [{ id: 'area-1', name: 'Secret area' }],
  sections: [{ id: 'section-1', title: 'Secret section' }],
};

vi.mock('@mindwtr/core', async () => {
  const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
  return {
    ...actual,
    useTaskStore: {
      getState: () => storeState,
    },
  };
});

vi.mock('./app-log', () => ({
  logInfo: vi.fn(async () => 'file://test.Registro'),
}));

import { PERFORMANCE_LOG_MESSAGE, PERFORMANCE_LOG_SCOPE } from '@mindwtr/core';
import { logInfo } from './app-log';
import {
  beginMobilePerformanceDiagnostic,
  finishMobilePerformanceDiagnostic,
  logMobilePerformanceDiagnostic,
  resolveMobilePerformanceRoute,
} from './performance-diagnostics';

describe('mobile performance diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.settings.diagnostics.loggingEnabled = true;
  });

  it('records content-free timing context when diagnostics logging is enabled', async () => {
    const measurement = beginMobilePerformanceDiagnostic({
      operation: 'task_done_to_list',
      route: 'project',
      listItemCount: 7,
    });

    await finishMobilePerformanceDiagnostic(measurement, { visibleItemCount: 5 });

    expect(logInfo).toHaveBeenCalledWith(PERFORMANCE_LOG_MESSAGE, {
      scope: PERFORMANCE_LOG_SCOPE,
      extra: expect.objectContaining({
        operation: 'task_done_to_list',
        route: 'project',
        taskCount: '2',
        projectCount: '1',
        areaCount: '1',
        sectionCount: '1',
        listItemCount: '7',
        visibleItemCount: '5',
      }),
    });
    const context = vi.mocked(logInfo).mock.calls[0]?.[1]?.extra ?? {};
    expect(context).not.toHaveProperty('taskId');
    expect(context).not.toHaveProperty('title');
    expect(context).not.toHaveProperty('projectId');
  });

  it('does not surface log backend failures', async () => {
    vi.mocked(logInfo).mockRejectedValueOnce(new Error('disk full'));

    const measurement = beginMobilePerformanceDiagnostic({
      operation: 'task_save_to_list',
      route: 'project',
    });

    await expect(finishMobilePerformanceDiagnostic(measurement)).resolves.toBeNull();
  });

  it('does not create measurements when diagnostics logging is disabled', async () => {
    storeState.settings.diagnostics.loggingEnabled = false;

    const measurement = beginMobilePerformanceDiagnostic({
      operation: 'task_save_to_list',
      route: 'project',
    });
    await finishMobilePerformanceDiagnostic(measurement);

    expect(measurement).toBeNull();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('records an explicit slow render duration without content fields', async () => {
    await logMobilePerformanceDiagnostic({
      operation: 'task_list_commit',
      route: 'project',
      elapsedMs: 1_234,
      listItemCount: 133,
      filterCount: 2,
    });

    expect(logInfo).toHaveBeenCalledWith(PERFORMANCE_LOG_MESSAGE, {
      scope: PERFORMANCE_LOG_SCOPE,
      extra: expect.objectContaining({
        operation: 'task_list_commit',
        route: 'project',
        elapsedMs: '1234',
        listItemCount: '133',
        filterCount: '2',
      }),
    });
    const context = vi.mocked(logInfo).mock.calls[0]?.[1]?.extra ?? {};
    expect(context).not.toHaveProperty('taskId');
    expect(context).not.toHaveProperty('title');
    expect(context).not.toHaveProperty('projectId');
  });

  it('derives routes without exposing ids', () => {
    expect(resolveMobilePerformanceRoute({ projectId: 'secret-project', statusFilter: 'inbox' })).toBe('project');
    expect(resolveMobilePerformanceRoute({ statusFilter: 'next' })).toBe('next');
    expect(resolveMobilePerformanceRoute({ statusFilter: 'done' })).toBe('unknown');
  });
});
