import React from 'react';
import { Alert } from 'react-native';
import renderer from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreActionResult } from '@mindwtr/core';

import TrashScreen from '../app/(drawer)/trash';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  areaFilter: {
    areaById: new Map<string, any>(),
    resolvedAreaFilter: { included: [] as string[], excluded: [] as string[] },
  },
  storeState: {
    _allTasks: [] as any[],
    _allProjects: [] as any[],
    projects: [] as any[],
    restoreTask: vi.fn(),
    restoreTasks: vi.fn(async (): Promise<StoreActionResult> => ({ success: true })),
    restoreProject: vi.fn(async (): Promise<StoreActionResult> => ({ success: true })),
    purgeTask: vi.fn(),
    purgeTasks: vi.fn(async (): Promise<StoreActionResult> => ({ success: true })),
    purgeProject: vi.fn(async (): Promise<StoreActionResult> => ({ success: true })),
    purgeDeletedTasks: vi.fn(),
    purgeDeletedProjects: vi.fn(),
    highlightTaskId: null as string | null,
    setHighlightTask: vi.fn(),
  },
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    FlatList: ({ data = [], renderItem, keyExtractor, ListEmptyComponent, ...props }: any) => {
      const children = data.length > 0
        ? data.map((item: any, index: number) => (
          <React.Fragment key={keyExtractor?.(item, index) ?? index}>
            {renderItem?.({ item, index })}
          </React.Fragment>
        ))
        : typeof ListEmptyComponent === 'function'
          ? <ListEmptyComponent />
          : ListEmptyComponent;

      return React.createElement('FlatList', { ...props, data }, children);
    },
  };
});

vi.mock('@mindwtr/core', async () => {
  const actual = await vi.importActual<any>('@mindwtr/core');
  return {
    ...actual,
    shallow: Object.is,
    // Ejecuta el selector real: la pantalla lee a través de
    // `useTaskStore((state) => ({…}), shallow)`, por lo que una simulación que ignora el
    // el selector nunca ejecuta la proyección que se supone debe cubrir.
    useTaskStore: (selector?: (state: unknown) => unknown) => (
      selector ? selector(mocks.storeState) : mocks.storeState
    ),
    getInlineMarkdownPreview: vi.fn((markdown: string) => markdown),
  };
});

vi.mock('@/components/markdown-text', () => ({
  MarkdownInlineText: ({ markdown, ...props }: any) => React.createElement('MarkdownInlineText', props, markdown),
}));

vi.mock('@/contexts/toast-context', () => ({
  useToast: () => ({ showToast: mocks.showToast, dismissToast: vi.fn() }),
}));

vi.mock('@/lib/app-log', () => ({
  logError: vi.fn(),
}));

vi.mock('../contexts/theme-context', () => ({
  useTheme: vi.fn(),
}));

vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => ({
      'common.tasks': 'tasks',
      'projects.title': 'Projects',
      'trash.deletedAt': 'Deleted',
      'trash.projectType': 'Project',
      'trash.taskType': 'Task',
    }[key] ?? key),
  }),
}));

vi.mock('@/hooks/use-mobile-area-filter', () => ({
  useMobileAreaFilter: () => mocks.areaFilter,
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#000000',
    border: '#222222',
    cardBg: '#111111',
    taskItemBg: '#111111',
    text: '#ffffff',
    secondaryText: '#999999',
    tint: '#3b82f6',
  }),
}));

vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children, ...props }: any) => (
    React.createElement('GestureHandlerRootView', props, children)
  ),
  Swipeable: ({ children }: any) => React.createElement('Swipeable', {}, children),
}));

describe('TrashScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.areaFilter.areaById = new Map();
    mocks.areaFilter.resolvedAreaFilter = { included: [], excluded: [] };
    mocks.storeState._allTasks = [{
      id: 'recent-task',
      title: 'Recently deleted task',
      status: 'inbox',
      tags: [],
      contexts: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
      deletedAt: '2026-07-13T12:00:00.000Z',
    }];
    mocks.storeState._allProjects = [{
      id: 'older-project',
      title: 'Older deleted project',
      status: 'archived',
      color: '#64748b',
      order: 0,
      tagIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z',
      deletedAt: '2026-07-01T12:00:00.000Z',
    }];
    mocks.storeState.projects = [];
  });

  it('passes one newest-deleted-first task and project timeline to FlatList', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    const flatList = tree.root.findByType('FlatList' as unknown as React.ElementType);
    const itemIds = flatList.props.data.map((item: any) => (
      item.type === 'task' ? item.task.id : item.project.id
    ));

    expect(itemIds).toEqual(['recent-task', 'older-project']);
  });

  const timelineIds = (tree: renderer.ReactTestRenderer) => tree.root
    .findByType('FlatList' as unknown as React.ElementType).props.data
    .map((item: any) => (item.type === 'task' ? item.task.id : item.project.id));

  it('narrows the trash timeline to the areas the filter includes', () => {
    mocks.areaFilter.areaById = new Map([['a1', { id: 'a1', name: 'Work', order: 0 }]]);
    mocks.storeState._allTasks[0].areaId = 'a1';
    mocks.areaFilter.resolvedAreaFilter = { included: ['a1'], excluded: [] };

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    // El proyecto no tiene un área, por lo que incluir 'Work' deja solo la tarea.
    expect(timelineIds(tree)).toEqual(['recent-task']);
  });

  it('drops trashed items whose area the filter excludes', () => {
    mocks.areaFilter.areaById = new Map([['a1', { id: 'a1', name: 'Work', order: 0 }]]);
    mocks.storeState._allTasks[0].areaId = 'a1';
    mocks.storeState._allProjects[0].areaId = 'a1';
    mocks.areaFilter.resolvedAreaFilter = { included: [], excluded: ['a1'] };

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    expect(timelineIds(tree)).toEqual([]);
  });

  const findPressableByLabel = (tree: renderer.ReactTestRenderer, label: string) => tree.root.findAll((node) => (
    node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function'
  ))[0];

  it('bulk restores all selected tasks and projects', async () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    renderer.act(() => { findPressableByLabel(tree, 'Select').props.onPress(); });
    renderer.act(() => { findPressableByLabel(tree, 'Select all').props.onPress(); });
    await renderer.act(async () => {
      findPressableByLabel(tree, 'trash.restore').props.onPress();
      await Promise.resolve();
    });

    expect(mocks.storeState.restoreTasks).toHaveBeenCalledWith(['recent-task']);
    expect(mocks.storeState.restoreProject).toHaveBeenCalledWith('older-project');
  });

  it('keeps selection and warns when one bulk restore result fails', async () => {
    mocks.storeState.restoreProject.mockResolvedValueOnce({ success: false, error: 'Project not found' });
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    renderer.act(() => { findPressableByLabel(tree, 'Select').props.onPress(); });
    renderer.act(() => { findPressableByLabel(tree, 'Select all').props.onPress(); });
    await renderer.act(async () => {
      await findPressableByLabel(tree, 'trash.restore').props.onPress();
    });

    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    expect(findPressableByLabel(tree, 'trash.deletePermanently')).toBeTruthy();
  });

  it('bulk purges selected items after confirming the alert', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    renderer.act(() => { findPressableByLabel(tree, 'Select').props.onPress(); });
    renderer.act(() => { findPressableByLabel(tree, 'Select all').props.onPress(); });
    renderer.act(() => { findPressableByLabel(tree, 'trash.deletePermanently').props.onPress(); });

    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    const confirmButton = buttons.find((button) => button.style === 'destructive');
    expect(confirmButton).toBeTruthy();
    await renderer.act(async () => {
      await confirmButton?.onPress?.();
    });

    expect(mocks.storeState.purgeTasks).toHaveBeenCalledWith(['recent-task']);
    expect(mocks.storeState.purgeProject).toHaveBeenCalledWith('older-project');
  });

  it('keeps selection and warns when one bulk purge result fails', async () => {
    mocks.storeState.purgeTasks.mockResolvedValueOnce({ success: false, error: 'Tasks not found' });
    const alertSpy = vi.spyOn(Alert, 'alert');
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<TrashScreen />);
    });

    renderer.act(() => { findPressableByLabel(tree, 'Select').props.onPress(); });
    renderer.act(() => { findPressableByLabel(tree, 'Select all').props.onPress(); });
    renderer.act(() => { findPressableByLabel(tree, 'trash.deletePermanently').props.onPress(); });
    const buttons = alertSpy.mock.calls[0]?.[2] ?? [];
    const confirmButton = buttons.find((button) => button.style === 'destructive');
    await renderer.act(async () => {
      await confirmButton?.onPress?.();
    });

    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    expect(findPressableByLabel(tree, 'trash.deletePermanently')).toBeTruthy();
  });
});
