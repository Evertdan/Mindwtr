import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('expo-router', () => ({ router: routerMock }));

import { openTaskScreen } from './task-meta-navigation';

describe('openTaskScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes the task screen by default', () => {
    openTaskScreen('t1', 'p1', 'task');
    expect(routerMock.push).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/projects-screen',
      params: expect.objectContaining({ projectId: 'p1', taskId: 't1', taskTab: 'task' }),
    }));
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  // #1029: the capture route's Save & edit swaps itself out — a push left the
  // filled capture form on the stack, so backing out of the editor reopened it.
  it('replaces the current route when asked', () => {
    openTaskScreen('t1', 'p1', 'task', { replace: true });
    expect(routerMock.replace).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/projects-screen',
      params: expect.objectContaining({ taskId: 't1' }),
    }));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('replaces to the focus screen when the task has no project', () => {
    openTaskScreen('t1', undefined, 'task', { replace: true });
    expect(routerMock.replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/focus' }));
  });
});
