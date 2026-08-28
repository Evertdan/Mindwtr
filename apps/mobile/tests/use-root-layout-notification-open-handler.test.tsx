import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRootLayoutNotificationOpenHandler } from '@/hooks/root-layout/use-root-layout-notification-open-handler';

type PendingNotificationOpenPayload = {
  actionIdentifier?: string;
  kind?: string;
  notificationId?: string;
  taskId?: string;
  projectId?: string;
  context?: string;
} | null;

const {
  setNotificationOpenHandler,
  setHighlightTask,
  updateTask,
  storeTasksById,
  consumePendingNotificationOpenPayload,
} = vi.hoisted(() => ({
  setNotificationOpenHandler: vi.fn(),
  setHighlightTask: vi.fn(),
  updateTask: vi.fn(async () => undefined),
  storeTasksById: new Map<string, any>(),
  consumePendingNotificationOpenPayload: vi.fn<() => Promise<PendingNotificationOpenPayload>>(async () => null),
}));

vi.mock('@mindwtr/core', async (importOriginal) => {
  const { mockCore } = await import('../test-support/mock-core');
  return mockCore(importOriginal, () => ({
    _tasksById: storeTasksById,
    tasks: Array.from(storeTasksById.values()),
    setHighlightTask,
    updateTask,
  }));
});

vi.mock('@/lib/notification-service', () => ({
  setNotificationOpenHandler,
}));

vi.mock('@/modules/notification-open-intents', () => ({
  consumePendingNotificationOpenPayload,
}));

function TestHarness({ router }: { router: { push: ReturnType<typeof vi.fn> } }) {
  useRootLayoutNotificationOpenHandler({
    appReady: true,
    pathname: '/inbox',
    router,
  });
  return null;
}

function TestHarnessWithState({
  appReady,
  pathname,
  router,
}: {
  appReady: boolean;
  pathname?: string | null;
  router: { push: ReturnType<typeof vi.fn> };
}) {
  useRootLayoutNotificationOpenHandler({
    appReady,
    pathname,
    router,
  });
  return null;
}

describe('useRootLayoutNotificationOpenHandler', () => {
  beforeEach(() => {
    setNotificationOpenHandler.mockReset();
    setHighlightTask.mockReset();
    updateTask.mockClear();
    storeTasksById.clear();
    consumePendingNotificationOpenPayload.mockReset();
    consumePendingNotificationOpenPayload.mockResolvedValue(null);
  });

  it('routes review notifications to the dedicated review flows', () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];
    expect(typeof handler).toBe('function');

    act(() => {
      handler({ kind: 'daily-digest', notificationId: 'daily-1' });
      handler({ kind: 'weekly-review', notificationId: 'weekly-1' });
    });

    expect(router.push).toHaveBeenNthCalledWith(1, {
      pathname: '/daily-review',
      params: { openToken: 'daily-1' },
    });
    expect(router.push).toHaveBeenNthCalledWith(2, {
      pathname: '/weekly-review',
      params: { openToken: 'weekly-1' },
    });
  });

  it('routes review date reminders to the review page before task or project fallbacks', () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'task-review', taskId: 'task-1', notificationId: 'review-task-1' });
      handler({ kind: 'project-review', projectId: 'project-1', notificationId: 'review-project-1' });
    });

    expect(setHighlightTask).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenNthCalledWith(1, {
      pathname: '/review-tab',
      params: { openToken: 'review-task-1', taskId: 'task-1' },
    });
    expect(router.push).toHaveBeenNthCalledWith(2, {
      pathname: '/review-tab',
      params: { openToken: 'review-project-1', projectId: 'project-1' },
    });
  });

  it('replays a pending Android notification open on mount', async () => {
    const router = { push: vi.fn() };
    consumePendingNotificationOpenPayload.mockResolvedValue({
      kind: 'weekly-review',
      notificationId: 'pending-weekly',
    });

    await act(async () => {
      create(<TestHarness router={router} />);
    });

    expect(consumePendingNotificationOpenPayload).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/weekly-review',
      params: { openToken: 'pending-weekly' },
    });
  });

  it('routes Android review alarm opens when only the alarm key is present', () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ notificationId: 'digest:evening' });
      handler({ notificationId: 'digest:weekly-review' });
    });

    expect(router.push).toHaveBeenNthCalledWith(1, {
      pathname: '/daily-review',
      params: { openToken: 'digest:evening' },
    });
    expect(router.push).toHaveBeenNthCalledWith(2, {
      pathname: '/weekly-review',
      params: { openToken: 'digest:weekly-review' },
    });
  });

  it('routes context automation notification taps to the matching Contexts screen', () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'context-automation', context: '@parents', notificationId: 'context-parents' });
    });

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contexts',
      params: { token: '@parents' },
    });
  });

  it("routes the story 2.1 'tdah-connection' kind (N-05's payload-store fallback) to T-01", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-connection' });
    });

    expect(router.push).toHaveBeenCalledWith('/tdah-today');
  });

  it("routes story 2.3's 'tdah-activity' start tap straight to T-02 with the action as an autoAction param, without mutating anything itself", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-activity', actionIdentifier: 'start', context: '42', notificationId: 'tdah-activity:42:start' });
    });

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/tdah-activity/42',
      params: { autoAction: 'start' },
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(setHighlightTask).not.toHaveBeenCalled();
  });

  it("routes the 'complete' action on a 'tdah-activity' notification to T-02 too, never auto-completing a GTD task", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-activity', actionIdentifier: 'complete', context: '7', notificationId: 'tdah-activity:7:end' });
    });

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/tdah-activity/7',
      params: { autoAction: 'complete' },
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("falls back to T-01 with no automatic action when the 'tdah-activity' notification's context is missing or not a valid positive integer id", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-activity', actionIdentifier: 'start', notificationId: 'tdah-activity:missing:start' });
      handler({ kind: 'tdah-activity', actionIdentifier: 'start', context: 'not-a-number', notificationId: 'tdah-activity:nan:start' });
      handler({ kind: 'tdah-activity', actionIdentifier: 'start', context: '0', notificationId: 'tdah-activity:zero:start' });
      handler({ kind: 'tdah-activity', actionIdentifier: 'start', context: '-3', notificationId: 'tdah-activity:negative:start' });
      // A non-integer numeric string (e.g. a float) is not a valid Activity
      // id either — Number.isFinite alone would wrongly accept it.
      handler({ kind: 'tdah-activity', actionIdentifier: 'start', context: '42.5', notificationId: 'tdah-activity:float:start' });
    });

    expect(router.push).toHaveBeenCalledTimes(5);
    expect(router.push).toHaveBeenNthCalledWith(1, '/tdah-today');
    expect(router.push).toHaveBeenNthCalledWith(2, '/tdah-today');
    expect(router.push).toHaveBeenNthCalledWith(3, '/tdah-today');
    expect(router.push).toHaveBeenNthCalledWith(4, '/tdah-today');
    expect(router.push).toHaveBeenNthCalledWith(5, '/tdah-today');
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("routes story 3.1's 'tdah-ritual' kind (N-03's tap) straight to T-05's placeholder route", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-ritual' });
    });

    expect(router.push).toHaveBeenCalledWith('/tdah-ritual');
    expect(updateTask).not.toHaveBeenCalled();
    expect(setHighlightTask).not.toHaveBeenCalled();
  });

  it("routes story 4.2's 'tdah-work-band' kind (N-04's tap) to T-01 with the band id, so the franja opens already expanded", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-work-band', context: '91', notificationId: 'tdah-work-band:91' });
    });

    expect(router.push).toHaveBeenCalledWith({ pathname: '/tdah-today', params: { workBandId: '91' } });
    expect(updateTask).not.toHaveBeenCalled();
    expect(setHighlightTask).not.toHaveBeenCalled();
  });

  it("still opens T-01 — just not expanded — when the 'tdah-work-band' context is missing or not a valid activity id", () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ kind: 'tdah-work-band', notificationId: 'tdah-work-band:missing' });
      handler({ kind: 'tdah-work-band', context: 'not-a-number', notificationId: 'tdah-work-band:nan' });
      handler({ kind: 'tdah-work-band', context: '0', notificationId: 'tdah-work-band:zero' });
    });

    expect(router.push).toHaveBeenCalledTimes(3);
    for (const call of router.push.mock.calls) {
      expect(call[0]).toBe('/tdah-today');
    }
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('waits for app readiness before replaying a pending open from the root path', async () => {
    const router = { push: vi.fn() };
    consumePendingNotificationOpenPayload.mockResolvedValue({
      kind: 'task-reminder',
      notificationId: 'pending-task',
      taskId: 'task-1',
    });

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<TestHarnessWithState appReady={false} pathname="/" router={router} />);
    });

    expect(router.push).not.toHaveBeenCalled();

    await act(async () => {
      tree.update(<TestHarnessWithState appReady pathname="/" router={router} />);
    });

    expect(setHighlightTask).toHaveBeenCalledWith('task-1');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/focus',
      params: expect.objectContaining({
        taskId: 'task-1',
        taskTab: 'view',
      }),
    });
  });

  it('routes task notification taps with a fresh open token so the editor can reopen', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    const router = { push: vi.fn() };

    try {
      act(() => {
        create(<TestHarness router={router} />);
      });

      const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

      act(() => {
        handler({ taskId: 'task-1', notificationId: 'notif-1' });
        handler({ taskId: 'task-1', notificationId: 'notif-1' });
      });

      expect(setHighlightTask).toHaveBeenCalledWith('task-1');
      expect(router.push).toHaveBeenNthCalledWith(1, {
        pathname: '/focus',
        params: { taskId: 'task-1', openToken: 'notif-1:12345:1', taskTab: 'view' },
      });
      expect(router.push).toHaveBeenNthCalledWith(2, {
        pathname: '/focus',
        params: { taskId: 'task-1', openToken: 'notif-1:12345:2', taskTab: 'view' },
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('marks a task done from a complete notification action without navigating', () => {
    const router = { push: vi.fn() };
    storeTasksById.set('task-1', {
      id: 'task-1',
      title: 'Pay rent',
      status: 'next',
    });

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ actionIdentifier: 'complete', taskId: 'task-1', notificationId: 'notif-1' });
      handler({ actionIdentifier: 'complete', taskId: 'task-1', notificationId: 'notif-1' });
    });

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith('task-1', {
      status: 'done',
      isFocusedToday: false,
    });
    expect(setHighlightTask).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ignores snooze and dismiss notification actions', () => {
    const router = { push: vi.fn() };

    act(() => {
      create(<TestHarness router={router} />);
    });

    const handler = setNotificationOpenHandler.mock.calls[0]?.[0];

    act(() => {
      handler({ actionIdentifier: 'snooze', taskId: 'task-1', notificationId: 'notif-1' });
      handler({ actionIdentifier: 'dismiss', taskId: 'task-1', notificationId: 'notif-2' });
    });

    expect(updateTask).not.toHaveBeenCalled();
    expect(setHighlightTask).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('clears the notification handler on unmount', () => {
    const router = { push: vi.fn() };
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(<TestHarness router={router} />);
    });

    act(() => {
      tree.unmount();
    });

    expect(setNotificationOpenHandler).toHaveBeenLastCalledWith(null);
  });
});
