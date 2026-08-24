import React from 'react';
import renderer from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import ArchivedScreen from '../app/(drawer)/archived';

const mocks = vi.hoisted(() => {
  const alert = vi.fn();
  const batchDeleteTasks = vi.fn();
  const batchMoveTasks = vi.fn();
  const batchUpdateTasks = vi.fn(async () => undefined);
  const deleteTask = vi.fn();
  const updateTask = vi.fn();
  const restoreTask = vi.fn(async () => undefined);
  const purgeTask = vi.fn();
  const updateProject = vi.fn();
  const deleteProject = vi.fn();
  const setHighlightTask = vi.fn();
  const showToast = vi.fn();
  return {
    alert,
    batchDeleteTasks,
    batchMoveTasks,
    batchUpdateTasks,
    deleteTask,
    updateTask,
    restoreTask,
    purgeTask,
    updateProject,
    deleteProject,
    setHighlightTask,
    showToast,
    areaFilter: {
      areaById: new Map<string, any>(),
      resolvedAreaFilter: { included: [] as string[], excluded: [] as string[] },
    },
    storeState: {
      _allTasks: [] as any[],
      projects: [] as any[],
      areas: [] as any[],
      settings: {} as any,
      batchDeleteTasks,
      batchMoveTasks,
      batchUpdateTasks,
      deleteTask,
      updateTask,
      restoreTask,
      purgeTask,
      updateProject,
      deleteProject,
      highlightTaskId: null as string | null,
      setHighlightTask,
    },
  };
});

vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    Alert: {
      ...actual.Alert,
      alert: mocks.alert,
    },
    Pressable: ({ children, ...props }: any) => React.createElement(
      'Pressable',
      props,
      typeof children === 'function' ? children({ pressed: false }) : children,
    ),
    FlatList: ({ data = [], renderItem, keyExtractor, ListEmptyComponent, ...props }: any) => {
      const children = data.length > 0
        ? data.map((item: any, index: number) => (
          <React.Fragment key={keyExtractor?.(item, index) ?? item.id ?? index}>
            {renderItem?.({ item, index })}
          </React.Fragment>
        ))
        : typeof ListEmptyComponent === 'function'
          ? <ListEmptyComponent />
          : ListEmptyComponent;

      return React.createElement('FlatList', props, children);
    },
  };
});

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  return {
    ...actual,
    shallow: Object.is,
    // Ejecuta el selector real: la pantalla lee a través de
    // `useTaskStore((state) => ({…}), shallow)`, por lo que una simulación que ignora el
    // el selector nunca ejecuta la proyección que se supone debe cubrir.
    useTaskStore: (selector?: (state: unknown) => unknown) => (
      selector ? selector(mocks.storeState) : mocks.storeState
    ),
    getInlineMarkdownPreview: vi.fn((markdown: string) => (markdown || '').split('\n')[0] ?? ''),
    safeFormatDate: vi.fn(() => 'May 12, 2026, 8:30 AM'),
  };
});

vi.mock('@/contexts/toast-context', () => ({
  useToast: () => ({ showToast: mocks.showToast, dismissToast: vi.fn() }),
}));

vi.mock('@/lib/app-log', () => ({
  logError: vi.fn(),
}));

vi.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/markdown-text', () => ({
  MarkdownInlineText: ({ markdown, ...props }: any) => React.createElement('MarkdownInlineText', props, markdown),
}));

vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => ({
      'archived.empty': 'No archived tasks',
      'archived.emptyHint': 'Archived tasks appear here',
      'bulk.confirmDeleteBody': 'Delete selected tasks?',
      'bulk.confirmDeleteTitle': 'Delete tasks',
      'bulk.select': 'Select',
      'bulk.selected': 'selected',
      'common.all': 'all',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.done': 'Done',
      'common.tasks': 'tasks',
      'list.done': 'Completed',
      'task.deleteConfirmBody': 'Move this task to Trash?',
      'trash.restoreToInbox': 'Restore to Inbox',
      'projects.title': 'Projects',
      'projects.deleteConfirm': 'Delete this project? Tasks in this project will be kept and moved to unassigned.',
      'archived.emptyProjects': 'No archived projects',
      'archived.emptyProjectsHint': 'Projects you archive will appear here',
    }[key] ?? key),
  }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#000000',
    taskItemBg: '#111111',
    text: '#ffffff',
    secondaryText: '#999999',
    tint: '#3b82f6',
    onTint: '#ffffff',
    filterBg: '#1a1a1a',
    border: '#333333',
    cardBg: '#0a0a0a',
  }),
}));

vi.mock('@/hooks/use-mobile-area-filter', () => ({
  useMobileAreaFilter: () => mocks.areaFilter,
}));

vi.mock('@/lib/task-meta-navigation', () => ({
  openContextsScreen: vi.fn(),
  openProjectScreen: vi.fn(),
}));

vi.mock('@/components/task-edit-modal', () => ({
  TaskEditModal: (props: any) => React.createElement('TaskEditModal', props),
}));

vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children, ...props }: any) => (
    React.createElement('GestureHandlerRootView', props, children)
  ),
  Swipeable: ({ children, renderLeftActions, renderRightActions }: any) => (
    React.createElement(
      'Swipeable',
      { renderLeftActions, renderRightActions },
      renderLeftActions?.(),
      renderRightActions?.(),
      children,
    )
  ),
}));

vi.mock('lucide-react-native', () => ({
  Archive: (props: any) => React.createElement('Archive', props),
  ChevronDown: (props: any) => React.createElement('ChevronDown', props),
  ChevronRight: (props: any) => React.createElement('ChevronRight', props),
  SlidersHorizontal: (props: any) => React.createElement('SlidersHorizontal', props),
}));

// El/La
// only a destination, so stub it rather than pull its whole icon/Modal tree in.
vi.mock('@/components/task-filter-sheet', () => ({
  TaskFilterSheet: (props: any) => React.createElement('TaskFilterSheet', props),
  FilterChip: (props: any) => React.createElement('FilterChip', props),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  },
}));

describe('ArchivedScreen', () => {
  const taskEditModalType = 'TaskEditModal' as unknown as React.ElementType;
  const flattenText = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map((item) => flattenText(item)).join('');
    return '';
  };
  const hasText = (tree: renderer.ReactTestRenderer, text: string) =>
    tree.root.findAll((node) => flattenText(node.props?.children).includes(text)).length > 0;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so restore the empty store or a test
    // that seeds persisted view state leaks it into the next one.
    vi.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
    mocks.areaFilter.areaById = new Map();
    mocks.areaFilter.resolvedAreaFilter = { included: [], excluded: [] };
    mocks.storeState.projects = [];
    mocks.storeState.areas = [];
    mocks.storeState.settings = {};
    mocks.storeState.highlightTaskId = null;
    mocks.storeState._allTasks = [
      {
        id: 'task-1',
        title: 'Archived task',
        description: 'Full archived details',
        status: 'archived',
        completedAt: '2026-05-12T08:30:00.000Z',
        createdAt: '2026-05-10T08:30:00.000Z',
        updatedAt: '2026-05-12T08:30:00.000Z',
      },
    ];
  });

  it('opens archived task details from the row and saves through the task editor', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    let modal = tree.root.findByType(taskEditModalType);
    expect(modal.props.visible).toBe(false);
    expect(modal.props.defaultTab).toBe('view');
    expect(hasText(tree, 'Completed: May 12, 2026, 8:30 AM')).toBe(true);

    const row = tree.root.find(
      (node) => node.props.accessibilityLabel === 'Open archived task details: Archived task',
    );

    renderer.act(() => {
      row.props.onPress();
    });

    modal = tree.root.findByType(taskEditModalType);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.task).toMatchObject({
      id: 'task-1',
      title: 'Archived task',
      description: 'Full archived details',
    });

    renderer.act(() => {
      modal.props.onSave('task-1', { description: 'Updated archived details' });
    });

    expect(mocks.updateTask).toHaveBeenCalledWith('task-1', { description: 'Updated archived details' });
    modal = tree.root.findByType(taskEditModalType);
    expect(modal.props.visible).toBe(false);
  });

  it('moves an archived task to Trash instead of purging it', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    const swipeable = tree.root.findByType('Swipeable' as unknown as React.ElementType);
    const deleteAction = swipeable.props.renderRightActions();

    renderer.act(() => {
      deleteAction.props.onPress();
    });

    const alertButtons = mocks.alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[];
    const confirmButton = alertButtons.find((button) => button.style === 'destructive');
    renderer.act(() => {
      confirmButton?.onPress?.();
    });

    expect(mocks.deleteTask).toHaveBeenCalledWith('task-1');
    expect(mocks.purgeTask).not.toHaveBeenCalled();
  });

  it('bulk restores selected archived tasks to Inbox', async () => {
    mocks.storeState._allTasks = [
      ...mocks.storeState._allTasks,
      {
        ...mocks.storeState._allTasks[0],
        id: 'task-2',
        title: 'Second archived task',
      },
    ];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select all').props.onPress();
    });
    await renderer.act(async () => {
      await tree.root.find((node) => node.props.accessibilityLabel === 'Restore to Inbox').props.onPress();
    });

    expect(mocks.batchMoveTasks).toHaveBeenCalledWith(['task-1', 'task-2'], 'inbox');
    expect(mocks.updateTask).not.toHaveBeenCalledWith('task-1', { status: 'inbox' });
  });

  it('keeps selection and warns when a bulk restore reports failure', async () => {
    mocks.batchMoveTasks.mockResolvedValueOnce({ success: false, error: 'Tasks not found: task-1' });
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select Archived task').props.onPress();
    });
    await renderer.act(async () => {
      await tree.root.find((node) => node.props.accessibilityLabel === 'Restore to Inbox').props.onPress();
    });

    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Restore to Inbox')).not.toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Move to Done')).toHaveLength(0);
  });

  it('bulk moves selected archived tasks to Trash', async () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select Archived task').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Delete').props.onPress();
    });

    const alertButtons = mocks.alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => Promise<void> | void }[];
    const confirmButton = alertButtons.find((button) => button.style === 'destructive');
    await renderer.act(async () => {
      await confirmButton?.onPress?.();
    });

    expect(mocks.batchDeleteTasks).toHaveBeenCalledWith(['task-1']);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  const archivedProject = {
    id: 'project-1',
    title: 'Archived project',
    status: 'archived',
    color: '#6B7280',
    order: 0,
    tagIds: [] as string[],
    createdAt: '2026-05-01T08:30:00.000Z',
    updatedAt: '2026-05-11T08:30:00.000Z',
  };

  const switchToProjects = (tree: renderer.ReactTestRenderer) => {
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Projects').props.onPress();
    });
  };

  // findAll matches the composite element and the host element it renders, so a
  // el conteo simple doble cuenta. Mantén solo nodos host.
  const countByLabel = (tree: renderer.ReactTestRenderer, label: string) => tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props.accessibilityLabel === label,
  ).length;

  const typeSearch = (tree: renderer.ReactTestRenderer, value: string) => {
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Search').props.onChangeText(value);
    });
  };

  it('narrows the archived list by search and restores it when cleared', () => {
    mocks.storeState._allTasks = [
      { ...mocks.storeState._allTasks[0], id: 'task-1', title: 'Quarterly report' },
      { ...mocks.storeState._allTasks[0], id: 'task-2', title: 'Fix the printer' },
    ];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    expect(hasText(tree, 'Quarterly report')).toBe(true);
    expect(hasText(tree, 'Fix the printer')).toBe(true);

    typeSearch(tree, 'printer');
    expect(hasText(tree, 'Quarterly report')).toBe(false);
    expect(hasText(tree, 'Fix the printer')).toBe(true);

    typeSearch(tree, '');
    expect(hasText(tree, 'Quarterly report')).toBe(true);
  });

  const workArea = { id: 'a1', name: 'Work', order: 0 };
  const homeArea = { id: 'a2', name: 'Home', order: 1 };

  const seedTwoAreaTasks = () => {
    mocks.areaFilter.areaById = new Map([[workArea.id, workArea], [homeArea.id, homeArea]]);
    mocks.storeState.areas = [workArea, homeArea];
    mocks.storeState._allTasks = [
      { ...mocks.storeState._allTasks[0], id: 'task-1', title: 'Quarterly report', areaId: 'a1' },
      { ...mocks.storeState._allTasks[0], id: 'task-2', title: 'Fix the printer', areaId: 'a2' },
    ];
  };

  it('shows only archived tasks the area filter includes', () => {
    seedTwoAreaTasks();
    mocks.areaFilter.resolvedAreaFilter = { included: ['a1'], excluded: [] };
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    expect(hasText(tree, 'Quarterly report')).toBe(true);
    expect(hasText(tree, 'Fix the printer')).toBe(false);
  });

  it('drops archived tasks whose area the filter excludes', () => {
    seedTwoAreaTasks();
    mocks.areaFilter.resolvedAreaFilter = { included: [], excluded: ['a1'] };
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    expect(hasText(tree, 'Quarterly report')).toBe(false);
    expect(hasText(tree, 'Fix the printer')).toBe(true);
  });

  it('folds a grouping heading, taking its rows off screen and out of Select all', async () => {
    mocks.storeState.areas = [{ id: 'a1', name: 'Work', order: 0 }];
    mocks.storeState._allTasks = [
      { ...mocks.storeState._allTasks[0], id: 'task-1', title: 'Quarterly report', areaId: 'a1' },
      { ...mocks.storeState._allTasks[0], id: 'task-2', title: 'Fix the printer' },
    ];
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key: string) => (
      key === 'mindwtr:view:archived:v1' ? JSON.stringify({ groupBy: 'area' }) : null
    ));

    let tree!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      tree = renderer.create(<ArchivedScreen />);
    });
    expect(hasText(tree, 'Quarterly report')).toBe(true);

    await renderer.act(async () => {
      tree.root.find((node) => node.props.testID === 'archived-group-header-a1').props.onPress();
    });

    // El encabezado y su conteo se mantienen, por lo que el grupo sigue siendo encontrable; la fila no.
    expect(hasText(tree, 'Work')).toBe(true);
    expect(hasText(tree, 'Quarterly report')).toBe(false);
    expect(hasText(tree, 'Fix the printer')).toBe(true);

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select all').props.onPress();
    });
    await renderer.act(async () => {
      await tree.root.find((node) => node.props.accessibilityLabel === 'Restore to Inbox').props.onPress();
    });

    expect(mocks.batchMoveTasks).toHaveBeenCalledWith(['task-2'], 'inbox');
  });

  it('counts a multi-tag task once when deciding whether every visible task is selected', async () => {
    mocks.storeState._allTasks = [
      { ...mocks.storeState._allTasks[0], tags: ['Work', 'Urgent'] },
    ];
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key: string) => (
      key === 'mindwtr:view:archived:v1' ? JSON.stringify({ groupBy: 'tag' }) : null
    ));

    let tree!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      tree = renderer.create(<ArchivedScreen />);
    });

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    const findSelectAll = () => tree.root.find(
      (node) => node.props.accessibilityLabel === 'Select all',
    );
    expect(findSelectAll().props.disabled).toBe(false);

    renderer.act(() => {
      findSelectAll().props.onPress();
    });

    expect(findSelectAll().props.disabled).toBe(true);
  });

  it('counts only the tasks left after filtering, so bulk actions cannot reach a hidden row', () => {
    mocks.storeState._allTasks = [
      { ...mocks.storeState._allTasks[0], id: 'task-1', title: 'Quarterly report' },
      { ...mocks.storeState._allTasks[0], id: 'task-2', title: 'Fix the printer' },
    ];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    expect(hasText(tree, '2 tasks')).toBe(true);
    typeSearch(tree, 'printer');
    expect(hasText(tree, '1 tasks')).toBe(true);
  });

  it('offers the search box while a filter is active even though nothing matches', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    typeSearch(tree, 'nothing matches this');
    // El estado vacío no debe llevar la caja de búsqueda con él, or the only way
    // back is to leave the screen.
    expect(countByLabel(tree, 'Search')).toBe(1);
    expect(hasText(tree, 'No tasks match these filters.')).toBe(true);
  });

  it('keeps the Filters button out of the Projects segment, which it does not apply to', () => {
    mocks.storeState.projects = [archivedProject];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    expect(countByLabel(tree, 'Filters')).toBe(1);
    switchToProjects(tree);
    expect(countByLabel(tree, 'Filters')).toBe(0);
  });

  it('renders archived projects when the Projects segment is selected', () => {
    mocks.storeState.projects = [archivedProject];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    expect(hasText(tree, 'Archived project')).toBe(false);
    switchToProjects(tree);
    expect(hasText(tree, 'Archived project')).toBe(true);
  });

  it('hides an archived project whose area the filter excludes', () => {
    mocks.areaFilter.areaById = new Map([[workArea.id, workArea]]);
    mocks.storeState.projects = [{ ...archivedProject, areaId: 'a1' }];
    mocks.areaFilter.resolvedAreaFilter = { included: [], excluded: ['a1'] };
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });
    switchToProjects(tree);

    expect(hasText(tree, 'Archived project')).toBe(false);
  });

  it('restores an archived project through updateProject with active status', () => {
    mocks.storeState.projects = [archivedProject];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });
    switchToProjects(tree);

    const swipeable = tree.root.findByType('Swipeable' as unknown as React.ElementType);
    const restoreAction = swipeable.props.renderLeftActions();
    renderer.act(() => {
      restoreAction.props.onPress();
    });

    expect(mocks.updateProject).toHaveBeenCalledWith('project-1', { status: 'active' });
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });

  it('deletes an archived project only after confirmation', () => {
    mocks.storeState.projects = [archivedProject];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });
    switchToProjects(tree);

    const swipeable = tree.root.findByType('Swipeable' as unknown as React.ElementType);
    const deleteAction = swipeable.props.renderRightActions();
    renderer.act(() => {
      deleteAction.props.onPress();
    });

    expect(mocks.deleteProject).not.toHaveBeenCalled();
    const alertButtons = mocks.alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[];
    const confirmButton = alertButtons.find((button) => button.style === 'destructive');
    renderer.act(() => {
      confirmButton?.onPress?.();
    });

    expect(mocks.deleteProject).toHaveBeenCalledWith('project-1');
  });
});
