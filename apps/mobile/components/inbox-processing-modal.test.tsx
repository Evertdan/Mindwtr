import React from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InboxProcessingModal } from './inbox-processing-modal';

const updateTask = vi.fn();
const deleteTask = vi.fn();
const addProject = vi.fn();
const addTask = vi.fn();
const push = vi.fn();
const clarifyTask = vi.fn();
const showToast = vi.fn();
const dismissToast = vi.fn();
const translate = (key: string) => ({
  'taskEdit.dateOnly': 'Date only',
}[key] ?? key);
const mockSettings = { gtd: { inboxProcessing: {} }, ai: {} } as any;
const baseInboxTask = {
  id: 'inbox-1',
  title: 'Inbox task',
  description: 'Original description',
  status: 'inbox',
  contexts: ['@home'],
  tags: ['#old'],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const workArea = {
  id: 'area-work',
  name: 'Work',
  color: '#2563eb',
  order: 0,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const homeArea = {
  id: 'area-home',
  name: 'Home',
  color: '#16a34a',
  order: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const workProject = {
  id: 'project-work',
  title: 'Work Project',
  color: '#2563eb',
  status: 'active',
  order: 0,
  tagIds: [],
  areaId: workArea.id,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const homeProject = {
  id: 'project-home',
  title: 'Home Project',
  color: '#16a34a',
  status: 'active',
  order: 1,
  tagIds: [],
  areaId: homeArea.id,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const storeState = {
  tasks: [{ ...baseInboxTask }] as any[],
  projects: [] as any[],
  areas: [] as any[],
  settings: mockSettings,
  updateTask,
  deleteTask,
  addProject,
  addTask,
  updateSettings: vi.fn(async () => {}),
};
const originalPlatformOs = Platform.OS;

const setPlatform = (os: typeof Platform.OS) => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
};

const flattenStyle = (style: unknown): Record<string, any> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, any>>((acc, item) => Object.assign(acc, flattenStyle(item)), {});
  }
  return style && typeof style === 'object' ? (style as Record<string, any>) : {};
};

vi.mock('@mindwtr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mindwtr/core')>();
  const formatDateOnly = (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };

  return {
    ...actual,
    addBreadcrumb: vi.fn(),
    DEFAULT_PROJECT_COLOR: '#3b82f6',
    collectTaskTokenUsage: vi.fn((tasks: any[], selector: (task: any) => string[] | undefined, options?: { prefix?: string }) => {
      const usage = new Map<string, { token: string; count: number; lastUsedAt: number }>();
      for (const task of tasks) {
        for (const token of selector(task) ?? []) {
          if (options?.prefix && !token.startsWith(options.prefix)) continue;
          const current = usage.get(token);
          const lastUsedAt = Date.parse(task.updatedAt || task.createdAt || '') || 0;
          if (current) {
            current.count += 1;
            current.lastUsedAt = Math.max(current.lastUsedAt, lastUsedAt);
          } else {
            usage.set(token, { token, count: 1, lastUsedAt });
          }
        }
      }
      return Array.from(usage.values());
    }),
    createAIProvider: vi.fn(() => ({
      clarifyTask,
    })),
    hasTimeComponent: vi.fn((value?: string | null) => Boolean(value && /[T\s]\d{2}:\d{2}/.test(value))),
    formatTimeEstimateLabel: vi.fn((value: string) => {
        if (value.startsWith('custom:')) return `${value.slice('custom:'.length)}m`;
        return value.replace('min', 'm').replace('hr+', 'h+').replace('hr', 'h');
    }),
    filterProjectsBySelectedArea: vi.fn((projects: any[], selectedAreaId?: string) => projects.filter((project: any) => (
      !project.deletedAt
      && project.status !== 'archived'
      && project.status !== 'completed'
      && (!selectedAreaId || project.areaId === selectedAreaId)
    ))),
    QUICK_DATE_PRESETS: ['today', 'tomorrow', 'in_3_days', 'next_week', 'next_month', 'no_date'],
    getQuickDate: vi.fn((preset: string) => {
      const today = new Date(2025, 0, 1);
      switch (preset) {
        case 'today':
          return today;
        case 'tomorrow':
          return new Date(2025, 0, 2);
        case 'in_3_days':
          return new Date(2025, 0, 4);
        case 'next_week':
          return new Date(2025, 0, 6);
        case 'next_month':
          return new Date(2025, 1, 1);
        case 'no_date':
          return null;
        default:
          return null;
      }
    }),
    isQuickDatePresetSelected: vi.fn(() => false),
    isSelectableProjectForTaskAssignment: vi.fn((project: any) => (
      !project.deletedAt && project.status !== 'archived' && project.status !== 'completed'
    )),
    getPersonSuggestionNames: vi.fn((people: any[] | undefined, tasks: any[], value: string | undefined, limit: number) => {
      const query = (value ?? '').trim().toLowerCase();
      if (!query) return [];
      const names = new Map<string, { name: string; lastUsedAt: number }>();
      for (const person of people ?? []) {
        if (person.deletedAt || typeof person.name !== 'string') continue;
        const name = person.name.trim();
        if (!name) continue;
        names.set(name.toLowerCase(), {
          name,
          lastUsedAt: Date.parse(person.updatedAt || person.createdAt || '') || 0,
        });
      }
      for (const task of tasks) {
        if (task.deletedAt || typeof task.assignedTo !== 'string') continue;
        const name = task.assignedTo.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const current = names.get(key);
        const lastUsedAt = Date.parse(task.updatedAt || task.createdAt || '') || 0;
        names.set(key, {
          name: current?.name ?? name,
          lastUsedAt: Math.max(current?.lastUsedAt ?? 0, lastUsedAt),
        });
      }
      return Array.from(names.values())
        .filter((entry) => entry.name.toLowerCase().includes(query))
        .filter((entry) => entry.name.toLowerCase() !== query)
        .sort((left, right) => right.lastUsedAt - left.lastUsedAt || left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((entry) => entry.name);
    }),
    isTaskInActiveProject: vi.fn(() => true),
    normalizeClockTimeInput: vi.fn((value?: string | null) => {
      const trimmed = String(value ?? '').trim();
      if (!trimmed) return '';
      const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }),
    resolveAutoTextDirection: vi.fn(() => 'ltr'),
    safeFormatDate: vi.fn((value: Date | string, formatStr: string) => {
      if (formatStr === 'yyyy-MM-dd') return formatDateOnly(value);
      return 'Jan 1, 2025';
    }),
    safeParseDate: vi.fn((value?: string) => (value ? new Date(value) : null)),
    tFallback: vi.fn((t: (key: string) => string, key: string, fallback: string) => {
      const translated = t(key);
      return translated && translated !== key ? translated : fallback;
    }),
    // El/La
    // Contexto subscribes field by field, so the mock has to honour selectors.
    useTaskStore: (selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    ),
    loadAIKey: vi.fn(),
  };
});

vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({
    t: translate,
    language: 'en',
  }),
}));

vi.mock('../contexts/theme-context', () => ({
  useTheme: () => ({ isDark: false }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../contexts/toast-context', () => ({
  useToast: () => ({
    showToast,
    dismissToast,
  }),
  ToastViewport: () => null,
}));

vi.mock('@/hooks/use-theme-tokens', () => ({
  useThemeTokens: () => ({ isMaterial: false, roles: null, shape: { large: 16 } }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#fff',
    cardBg: '#f8fafc',
    taskItemBg: '#fff',
    inputBg: '#fff',
    filterBg: '#f1f5f9',
    border: '#cbd5e1',
    text: '#0f172a',
    secondaryText: '#64748b',
    icon: '#64748b',
    tint: '#3b82f6',
    onTint: '#fff',
    tabIconDefault: '#94a3b8',
    tabIconSelected: '#3b82f6',
    danger: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  }),
}));

vi.mock('../lib/ai-config', () => ({
  loadAIKey: vi.fn().mockResolvedValue(''),
  isAIKeyRequired: vi.fn().mockReturnValue(false),
  buildAIConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('../lib/app-log', () => ({
  logWarn: vi.fn(),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: any) => React.createElement('DateTimePicker', props, props.children),
}));

describe('InboxProcessingModal', () => {
  beforeEach(() => {
    mockSettings.features = undefined;
    mockSettings.gtd = { inboxProcessing: {}, taskEditor: undefined };
    mockSettings.ai = {};
    mockSettings.filters = undefined;
    storeState.tasks = [{ ...baseInboxTask }];
    storeState.projects = [];
    storeState.areas = [];
    updateTask.mockReset();
    updateTask.mockResolvedValue({ success: true });
    deleteTask.mockReset();
    deleteTask.mockResolvedValue({ success: true });
    addProject.mockClear();
    addTask.mockReset();
    addTask.mockResolvedValue({ success: true });
    push.mockClear();
    clarifyTask.mockClear();
    showToast.mockClear();
    dismissToast.mockClear();
  });

  afterEach(() => {
    setPlatform(originalPlatformOs);
  });

  const findNodeWithText = (root: ReturnType<typeof create>['root'], text: string) => {
    return root.find((node) => {
      const children = node.props?.children;
      if (children === text) return true;
      if (Array.isArray(children)) {
        return children.some((child) => child === text);
      }
      return false;
    });
  };

  const findNodesWithText = (root: ReturnType<typeof create>['root'], text: string) => {
    return root.findAll((node) => {
      const children = node.props?.children;
      if (children === text) return true;
      if (Array.isArray(children)) {
        return children.some((child) => child === text);
      }
      return false;
    });
  };

  const flushAsyncActions = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const findPressableWithText = (root: ReturnType<typeof create>['root'], text: string) => {
    let node: any = findNodeWithText(root, text);
    while (node && typeof node.props?.onPress !== 'function') {
      node = node.parent;
    }
    if (!node) {
      throw new Error(`Pressable for "${text}" not found`);
    }
    return node;
  };

  const chooseActionableLonger = (root: ReturnType<typeof create>['root']) => {
    act(() => {
      findPressableWithText(root, 'inbox.yesActionable').props.onPress();
    });
    act(() => {
      findPressableWithText(root, 'inbox.takesLonger').props.onPress();
    });
  };

  const revealDeferredOptions = (root: ReturnType<typeof create>['root']) => {
    chooseActionableLonger(root);
    act(() => {
      findPressableWithText(root, 'inbox.illDoIt').props.onPress();
    });
    const moreOptions = findPressableWithText(root, 'More options');
    if (!moreOptions.props.accessibilityState?.expanded) {
      act(() => {
        moreOptions.props.onPress();
      });
    }
  };

  it('reveals one Inbox decision at a time and requires an explicit path', () => {
    storeState.tasks = [{ ...baseInboxTask, contexts: [], tags: [] }];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const nextTaskButton = findPressableWithText(root, 'Next task →');

    expect(nextTaskButton.props.disabled).toBe(true);
    expect(findNodesWithText(root, 'inbox.twoMinRule')).toHaveLength(0);
    expect(findNodesWithText(root, 'inbox.whoShouldDoIt')).toHaveLength(0);

    act(() => {
      findPressableWithText(root, 'inbox.yesActionable').props.onPress();
    });

    expect(findNodesWithText(root, 'inbox.twoMinRule').length).toBeGreaterThan(0);
    expect(findNodesWithText(root, 'inbox.whoShouldDoIt')).toHaveLength(0);

    act(() => {
      findPressableWithText(root, 'inbox.takesLonger').props.onPress();
    });

    expect(findNodesWithText(root, 'inbox.whoShouldDoIt').length).toBeGreaterThan(0);
    expect(root.findByProps({ children: 'Next task →' }).parent?.props.disabled).toBe(true);

    act(() => {
      findPressableWithText(root, 'inbox.illDoIt').props.onPress();
    });

    expect(findPressableWithText(root, 'More options').props.accessibilityState).toEqual({ expanded: false });
    expect(root.findByProps({ children: 'Next task →' }).parent?.props.disabled).toBe(false);
  });

  it('keeps optional scheduling available for delegated tasks without showing project metadata', () => {
    mockSettings.gtd.inboxProcessing = { scheduleEnabled: true };
    storeState.tasks = [{ ...baseInboxTask, contexts: [], tags: [] }];
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={vi.fn()} />);
    });

    const root = tree!.root;
    chooseActionableLonger(root);

    act(() => {
      findPressableWithText(root, 'inbox.delegate').props.onPress();
    });
    act(() => {
      findPressableWithText(root, 'More options').props.onPress();
    });

    expect(findNodesWithText(root, 'taskEdit.scheduling').length).toBeGreaterThan(0);
    expect(root.findAllByProps({ placeholder: 'projects.addPlaceholder' })).toHaveLength(0);
    expect(root.findAllByProps({ placeholder: 'inbox.addContextPlaceholder' })).toHaveLength(0);
  });

  it('keeps the processing form keyboard-aware on iOS', () => {
    setPlatform('ios');
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const keyboardAvoidingView = tree!.root.findByType(KeyboardAvoidingView);
    expect(keyboardAvoidingView.props.behavior).toBe('padding');
    expect(keyboardAvoidingView.props.keyboardVerticalOffset).toBe(48);

    const processingScroll = tree!.root.findByType(ScrollView);

    expect(processingScroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(processingScroll.props.keyboardDismissMode).toBe('interactive');
    expect(processingScroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('lifts the Android processing form by the measured keyboard inset instead of resizing', () => {
    setPlatform('android');
    const listeners = new Map<string, (event?: any) => void>();
    const addListener = vi.spyOn(Keyboard, 'addListener').mockImplementation((event: string, callback: any) => {
      listeners.set(event, callback);
      return { remove: vi.fn() } as any;
    });
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    expect(addListener).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    expect(addListener).toHaveBeenCalledWith('keyboardDidChangeFrame', expect.any(Function));
    expect(addListener).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function));

    act(() => {
      listeners.get('keyboardDidShow')?.({ endCoordinates: { height: 280 } });
    });

    const keyboardAvoidingView = tree!.root.findByType(KeyboardAvoidingView);
    expect(keyboardAvoidingView.props.behavior).toBeUndefined();
    expect(flattenStyle(keyboardAvoidingView.props.style).paddingBottom).toBe(280);

    act(() => {
      listeners.get('keyboardDidHide')?.();
    });

    expect(flattenStyle(tree!.root.findByType(KeyboardAvoidingView).props.style).paddingBottom).toBeUndefined();
  });

  it('replaces the header next action with skip and saves edits before advancing', async () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = {};
    storeState.projects = [];
    storeState.areas = [];
    updateTask.mockClear();
    deleteTask.mockClear();
    addProject.mockClear();
    addTask.mockClear();
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const titleInput = root.findByProps({ placeholder: 'taskEdit.titleLabel' });
    const descriptionInput = root.findByProps({ placeholder: 'taskEdit.descriptionPlaceholder' });

    act(() => {
      titleInput.props.onChangeText('Renamed inbox task');
      descriptionInput.props.onChangeText('Updated description');
    });

    const skipLabel = root.findByProps({ children: 'Skip' });
    const skipButton = skipLabel.parent;

    if (!skipButton) {
      throw new Error('Skip button not found');
    }

    act(() => {
      skipButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        title: 'Renamed inbox task',
        description: 'Updated description',
        projectId: undefined,
        contexts: ['@home'],
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the two-minute section when that shortcut is disabled', () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = { twoMinuteEnabled: false };
    storeState.projects = [];
    storeState.areas = [];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    expect(root.findAllByProps({ children: '✅ inbox.doneIt' })).toHaveLength(0);
  });

  it('hides the contexts and tags section when disabled', () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = { contextStepEnabled: false };
    storeState.projects = [];
    storeState.areas = [];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    expect(root.findAllByProps({ placeholder: 'inbox.addContextPlaceholder' })).toHaveLength(0);
  });

  it('preselects the task area and filters project choices by it', () => {
    storeState.tasks = [{ ...baseInboxTask, areaId: workArea.id }];
    storeState.areas = [workArea, homeArea];
    storeState.projects = [workProject, homeProject];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    // El/La
    // project picker opens filtered to it (and apply keeps the area).
    expect(findNodesWithText(root, 'taskEdit.areaLabel').length).toBeGreaterThan(0);
    expect(findNodesWithText(root, 'Work Project').length).toBeGreaterThan(0);
    expect(findNodesWithText(root, 'Home Project')).toHaveLength(0);

    act(() => {
      findPressableWithText(root, 'projects.noArea').props.onPress();
    });

    expect(findNodesWithText(root, 'Work Project').length).toBeGreaterThan(0);
    expect(findNodesWithText(root, 'Home Project').length).toBeGreaterThan(0);
  });

  it('searches projects outside the selected area while the browse list stays scoped (#987)', () => {
    storeState.tasks = [{ ...baseInboxTask, areaId: workArea.id }];
    storeState.areas = [workArea, homeArea];
    storeState.projects = [workProject, homeProject];
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={vi.fn()} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    expect(findNodesWithText(root, 'Home Project')).toHaveLength(0);

    const projectSearch = root.findByProps({ placeholder: 'projects.addPlaceholder' });

    act(() => {
      projectSearch.props.onChangeText('Home');
    });

    expect(findNodesWithText(root, 'Home Project').length).toBeGreaterThan(0);
    // An existing title anywhere suppresses the create offer, not just in-area ones.
    act(() => {
      root.findByProps({ placeholder: 'projects.addPlaceholder' }).props.onChangeText('Home Project');
    });
    expect(findNodesWithText(root, 'projects.create')).toHaveLength(0);

    act(() => {
      root.findByProps({ placeholder: 'projects.addPlaceholder' }).props.onChangeText('');
    });

    expect(findNodesWithText(root, 'Home Project')).toHaveLength(0);
    expect(findNodesWithText(root, 'Work Project').length).toBeGreaterThan(0);
  });

  it('respects the global area filter when building the processing queue', async () => {
    mockSettings.filters = { areaId: workArea.id };
    storeState.areas = [workArea, homeArea];
    storeState.projects = [workProject, homeProject];
    storeState.tasks = [
      {
        ...baseInboxTask,
        id: 'home-inbox',
        title: 'Home inbox',
        projectId: homeProject.id,
        contexts: [],
        tags: [],
      },
      {
        ...baseInboxTask,
        id: 'work-inbox',
        title: 'Work inbox',
        projectId: workProject.id,
        contexts: [],
        tags: [],
      },
    ];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    expect(root.findByProps({ placeholder: 'taskEdit.titleLabel' }).props.value).toBe('Work inbox');

    const skipLabel = root.findByProps({ children: 'Skip' });
    const skipButton = skipLabel.parent;

    if (!skipButton) {
      throw new Error('Skip button not found');
    }

    act(() => {
      skipButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'work-inbox',
      expect.objectContaining({
        title: 'Work inbox',
      }),
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('creates inbox processing projects in the selected area', async () => {
    storeState.areas = [workArea, homeArea];
    storeState.projects = [workProject, homeProject];
    addProject.mockResolvedValueOnce({
      id: 'project-created',
      title: 'Created Project',
      color: '#3b82f6',
      status: 'active',
      order: 2,
      tagIds: [],
      areaId: workArea.id,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const projectInput = root.findByProps({ placeholder: 'projects.addPlaceholder' });

    act(() => {
      findPressableWithText(root, 'Work').props.onPress();
      projectInput.props.onChangeText('Created Project');
    });

    await act(async () => {
      findPressableWithText(root, 'projects.create').props.onPress();
    });

    expect(addProject).toHaveBeenCalledWith(
      'Created Project',
      '#3b82f6',
      { areaId: workArea.id },
    );
  });

  it('converts an inbox item into a project next action on mobile', async () => {
    storeState.areas = [workArea, homeArea];
    storeState.projects = [];
    addProject.mockResolvedValueOnce({
      id: 'project-created',
      title: 'Plan Launch',
      color: '#3b82f6',
      status: 'active',
      order: 0,
      tagIds: [],
      areaId: workArea.id,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    act(() => {
      findPressableWithText(root, 'process.moreThanOneStepYes').props.onPress();
    });

    const projectTitleInput = root.findByProps({ accessibilityLabel: 'projects.title' });
    const nextActionInput = root.findByProps({ accessibilityLabel: 'process.nextAction' });

    act(() => {
      findPressableWithText(root, 'Work').props.onPress();
      projectTitleInput.props.onChangeText('Plan Launch');
      nextActionInput.props.onChangeText('Draft launch brief');
    });

    await act(async () => {
      findPressableWithText(root, 'process.createProject').props.onPress();
    });

    expect(addProject).toHaveBeenCalledWith(
      'Plan Launch',
      '#3b82f6',
      { areaId: workArea.id },
    );
    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        title: 'Draft launch brief',
        status: 'next',
        projectId: 'project-created',
        areaId: undefined,
        contexts: ['@home'],
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('chains a fresh action input from keyboard submit instead of converting (#827)', () => {
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    act(() => {
      findPressableWithText(root, 'process.moreThanOneStepYes').props.onPress();
    });

    const findActionInputs = () => root.findAll((node) => (
      typeof node.type === 'string'
      && node.props.accessibilityLabel === 'process.nextAction'
      && typeof node.props.onChangeText === 'function'
    ));

    act(() => {
      findActionInputs()[0].props.onChangeText('Draft launch brief');
    });
    act(() => {
      findActionInputs()[0].props.onSubmitEditing();
    });
    expect(findActionInputs()).toHaveLength(2);
    expect(findActionInputs()[0].props.blurOnSubmit).toBe(false);

    act(() => {
      findActionInputs()[1].props.onChangeText('Book venue');
    });
    act(() => {
      findActionInputs()[1].props.onSubmitEditing();
    });
    expect(findActionInputs()).toHaveLength(3);

    // Submit on an empty trailing row must not add another.
    act(() => {
      findActionInputs()[2].props.onSubmitEditing();
    });
    expect(findActionInputs()).toHaveLength(3);

    expect(addProject).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('creates extra next actions in the new project when added at the split step (#827)', async () => {
    addProject.mockResolvedValueOnce({
      id: 'project-created',
      title: 'Plan Launch',
      color: '#3b82f6',
      status: 'active',
      order: 0,
      tagIds: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    act(() => {
      findPressableWithText(root, 'process.moreThanOneStepYes').props.onPress();
    });
    act(() => {
      root.findByProps({ accessibilityLabel: 'projects.title' }).props.onChangeText('Plan Launch');
    });
    act(() => {
      findPressableWithText(root, 'process.addAnotherAction').props.onPress();
    });
    act(() => {
      findPressableWithText(root, 'process.addAnotherAction').props.onPress();
    });

    const findActionInputs = () => root.findAll((node) => (
      typeof node.type === 'string'
      && node.props.accessibilityLabel === 'process.nextAction'
      && typeof node.props.onChangeText === 'function'
    ));
    expect(findActionInputs()).toHaveLength(3);
    act(() => {
      findActionInputs()[0].props.onChangeText('Draft launch brief');
    });
    act(() => {
      findActionInputs()[1].props.onChangeText('Book venue');
    });
    act(() => {
      findActionInputs()[2].props.onChangeText('   ');
    });

    await act(async () => {
      findPressableWithText(root, 'process.createProject').props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        title: 'Draft launch brief',
        status: 'next',
        projectId: 'project-created',
      })
    );
    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith('Book venue', {
      status: 'inbox',
      projectId: 'project-created',
    });
  });

  it('suggests existing contexts and tags while typing without a prefix', () => {
    mockSettings.gtd.taskEditor = { hidden: [] };
    storeState.tasks = [
      { ...baseInboxTask },
      {
        id: 'metadata-task',
        title: 'Metadata task',
        status: 'next',
        contexts: ['@office'],
        tags: ['#urgent'],
        createdAt: '2025-01-02T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      },
    ];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const tokenInput = root.findByProps({ placeholder: 'inbox.addContextPlaceholder' });

    act(() => {
      tokenInput.props.onChangeText('off');
    });

    const contextSuggestion = findNodeWithText(root, '@office');
    expect(contextSuggestion).toBeTruthy();
    expect(typeof contextSuggestion.parent?.props.onPress).toBe('function');

    const updatedTokenInput = root.findByProps({ placeholder: 'inbox.addContextPlaceholder' });
    act(() => {
      updatedTokenInput.props.onChangeText('urg');
    });

    expect(findNodeWithText(root, '#urgent')).toBeTruthy();
  });

  it('suggests existing assignees in the assigned-to field', () => {
    mockSettings.gtd.taskEditor = { hidden: [] };
    storeState.tasks = [
      { ...baseInboxTask },
      {
        id: 'waiting-1',
        title: 'Waiting task',
        status: 'waiting',
        assignedTo: 'Alexandra',
        contexts: [],
        tags: [],
        createdAt: '2025-01-02T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      },
    ];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const assignedToInput = root.findByProps({ placeholder: 'taskEdit.assignedToPlaceholder' });

    act(() => {
      assignedToInput.props.onChangeText('alex');
    });

    const suggestion = findNodeWithText(root, 'Alexandra');
    expect(suggestion).toBeTruthy();

    act(() => {
      suggestion.parent?.props.onPress();
    });

    expect(root.findByProps({ placeholder: 'taskEdit.assignedToPlaceholder' }).props.value).toBe('Alexandra');
  });

  it('still shows reference during inbox processing when the old setting is disabled', () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = { referenceEnabled: false };
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    expect(findNodeWithText(root, 'nav.reference')).toBeTruthy();
  });

  it('starts mobile inbox processing at the refine form without duplicating the task preview', () => {
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    expect(root.findByProps({ children: 'inbox.refineTitle' })).toBeTruthy();
    expect(findNodesWithText(root, 'Inbox task')).toHaveLength(0);
    expect(findNodesWithText(root, 'Original description')).toHaveLength(0);
  });

  it('includes future-start inbox tasks in processing', () => {
    storeState.tasks = [{
      ...baseInboxTask,
      startTime: '2999-01-01',
    }];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    expect(root.findByProps({ children: 'inbox.refineTitle' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves Later items to next with a date-only start date', async () => {
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const laterButton = findPressableWithText(root, 'Later');

    if (!laterButton) {
      throw new Error('Later button not found');
    }

    act(() => {
      laterButton.props.onPress();
    });

    const startValueLabel = root.findByProps({ children: 'common.notSet' });
    const startButton = startValueLabel.parent;

    if (!startButton) {
      throw new Error('Start date button not found');
    }

    act(() => {
      startButton.props.onPress();
    });

    const datePicker = root.findByType('DateTimePicker' as any);

    act(() => {
      datePicker.props.onChange({ type: 'set' }, new Date(2026, 2, 23, 12, 0, 0));
    });

    const nextTaskLabel = findNodeWithText(root, 'Next task →');
    const nextTaskButton = nextTaskLabel.parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'next',
        startTime: '2026-03-23',
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('moves Later items with the configured default schedule time', () => {
    mockSettings.gtd.defaultScheduleTime = '09:00';
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const laterButton = findPressableWithText(root, 'Later');

    if (!laterButton) {
      throw new Error('Later button not found');
    }

    act(() => {
      laterButton.props.onPress();
    });

    const startButton = root.findByProps({ children: 'common.notSet' }).parent;

    if (!startButton) {
      throw new Error('Start date button not found');
    }

    act(() => {
      startButton.props.onPress();
    });

    const datePicker = root.findByType('DateTimePicker' as any);

    act(() => {
      datePicker.props.onChange({ type: 'set' }, new Date(2026, 2, 23, 12, 0, 0));
    });

    const nextTaskButton = findNodeWithText(root, 'Next task →').parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'next',
        startTime: '2026-03-23T09:00',
      })
    );
  });

  it('allows Later items to stay date-only when a default schedule time is configured', () => {
    mockSettings.gtd.defaultScheduleTime = '09:00';
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const laterButton = findPressableWithText(root, 'Later');

    if (!laterButton) {
      throw new Error('Later button not found');
    }

    act(() => {
      laterButton.props.onPress();
    });

    const startButton = root.findByProps({ children: 'common.notSet' }).parent;

    if (!startButton) {
      throw new Error('Start date button not found');
    }

    act(() => {
      startButton.props.onPress();
    });

    const datePicker = root.findByType('DateTimePicker' as any);

    act(() => {
      datePicker.props.onChange({ type: 'set' }, new Date(2026, 2, 23, 12, 0, 0));
    });

    const dateOnlyLabel = findNodeWithText(root, 'Date only');
    const dateOnlyButton = dateOnlyLabel.parent;

    if (!dateOnlyButton) {
      throw new Error('Date only button not found');
    }

    act(() => {
      dateOnlyButton.props.onPress();
    });

    const nextTaskButton = findNodeWithText(root, 'Next task →').parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'next',
        startTime: '2026-03-23',
      })
    );
  });

  it('moves Later items to next when No date is explicitly selected', async () => {
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const laterButton = findPressableWithText(root, 'Later');

    if (!laterButton) {
      throw new Error('Later button not found');
    }

    act(() => {
      laterButton.props.onPress();
    });

    const noDateButton = findNodeWithText(root, 'No date').parent;

    if (!noDateButton) {
      throw new Error('No date button not found');
    }

    expect(noDateButton.props.accessibilityState?.selected).toBe(false);

    act(() => {
      noDateButton.props.onPress();
    });

    const selectedNoDateButton = findNodeWithText(root, 'No date').parent;

    if (!selectedNoDateButton) {
      throw new Error('No date button not found after selection');
    }

    expect(selectedNoDateButton.props.accessibilityState?.selected).toBe(true);

    const nextTaskButton = findNodeWithText(root, 'Next task →').parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'next',
      })
    );
    expect(updateTask.mock.calls[0][1]).toHaveProperty('startTime', undefined);
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('advances to the next inbox item when Later No date is selected directly', async () => {
    storeState.tasks = [
      { ...baseInboxTask },
      {
        ...baseInboxTask,
        id: 'inbox-2',
        title: 'Second inbox task',
        description: 'Second description',
        contexts: [],
        tags: [],
      },
    ];
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const laterButton = findPressableWithText(root, 'Later');

    if (!laterButton) {
      throw new Error('Later button not found');
    }

    act(() => {
      laterButton.props.onPress();
    });

    const noDateButton = findNodeWithText(root, 'No date').parent;

    if (!noDateButton) {
      throw new Error('No date button not found');
    }

    act(() => {
      noDateButton.props.onPress();
    });

    const nextTaskButton = findNodeWithText(root, 'Next task →').parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'next',
      })
    );
    expect(updateTask.mock.calls[0][1]).toHaveProperty('startTime', undefined);
    await flushAsyncActions();
    expect(onClose).not.toHaveBeenCalled();
    expect(root.findByProps({ placeholder: 'taskEdit.titleLabel' }).props.value).toBe('Second inbox task');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('saves the selected priority when the priority field is shown', async () => {
    mockSettings.gtd.taskEditor = { hidden: [] };
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const priorityLabel = root.findByProps({ children: 'priority.high' });
    const priorityButton = priorityLabel.parent;

    if (!priorityButton) {
      throw new Error('Priority button not found');
    }

    act(() => {
      priorityButton.props.onPress();
    });

    const skipLabel = root.findByProps({ children: 'Skip' });
    const skipButton = skipLabel.parent;

    if (!skipButton) {
      throw new Error('Skip button not found');
    }

    act(() => {
      skipButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        projectId: undefined,
        contexts: ['@home'],
        priority: 'high',
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('saves energy level and time estimate during inbox processing', async () => {
    mockSettings.gtd.taskEditor = { hidden: [] };
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const energyLabel = root.findByProps({ children: 'energyLevel.high' });
    const energyButton = energyLabel.parent;
    const estimateLabel = root.findByProps({ children: '30m' });
    const estimateButton = estimateLabel.parent;
    const skipLabel = root.findByProps({ children: 'Skip' });
    const skipButton = skipLabel.parent;

    if (!energyButton || !estimateButton || !skipButton) {
      throw new Error('Expected inbox processing controls were not found');
    }

    act(() => {
      energyButton.props.onPress();
      estimateButton.props.onPress();
    });

    act(() => {
      skipButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        energyLevel: 'high',
        timeEstimate: '30min',
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('hides organization fields when the task editor layout disables them', () => {
    mockSettings.gtd = {
      inboxProcessing: {},
      taskEditor: {
        hidden: ['energyLevel', 'timeEstimate'],
      },
    };
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;

    revealDeferredOptions(root);

    expect(root.findAllByProps({ children: 'taskEdit.energyLevel' })).toHaveLength(0);
    expect(root.findAllByProps({ children: 'taskEdit.timeEstimateLabel' })).toHaveLength(0);
    expect(root.findAllByProps({ children: 'energyLevel.high' })).toHaveLength(0);
    expect(root.findAllByProps({ children: '30m' })).toHaveLength(0);
  });

  it('moves delegated tasks to waiting with assignedTo and keeps the description clean', async () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = {};
    storeState.projects = [];
    storeState.areas = [];
    updateTask.mockClear();
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    chooseActionableLonger(root);
    const delegateButton = findPressableWithText(root, 'inbox.delegate');

    if (!delegateButton) {
      throw new Error('Delegate button not found');
    }

    act(() => {
      delegateButton.props.onPress();
    });

    const whoInput = root.findByProps({ placeholder: 'process.delegateWhoPlaceholder' });

    act(() => {
      whoInput.props.onChangeText('Alex');
    });

    const nextTaskLabel = findNodeWithText(root, 'Next task →');
    const nextTaskButton = nextTaskLabel.parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'waiting',
        assignedTo: 'Alex',
        description: 'Original description',
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the selected priority when delegating a task', async () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = {};
    mockSettings.gtd.taskEditor = { hidden: [] };
    storeState.projects = [];
    storeState.areas = [];
    updateTask.mockClear();
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const priorityLabel = root.findByProps({ children: 'priority.high' });
    const priorityButton = priorityLabel.parent;

    if (!priorityButton) {
      throw new Error('Priority button not found');
    }

    act(() => {
      priorityButton.props.onPress();
    });

    const delegateButton = findPressableWithText(root, 'inbox.delegate');

    if (!delegateButton) {
      throw new Error('Delegate button not found');
    }

    act(() => {
      delegateButton.props.onPress();
    });

    const whoInput = root.findByProps({ placeholder: 'process.delegateWhoPlaceholder' });

    act(() => {
      whoInput.props.onChangeText('Alex');
    });

    const nextTaskLabel = findNodeWithText(root, 'Next task →');
    const nextTaskButton = nextTaskLabel.parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'waiting',
        assignedTo: 'Alex',
        priority: 'high',
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the selected priority when delegating a task', async () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = {};
    mockSettings.gtd.taskEditor = { hidden: [] };
    storeState.projects = [];
    storeState.areas = [];
    updateTask.mockClear();
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    revealDeferredOptions(root);
    const priorityLabel = root.findByProps({ children: 'priority.urgent' });
    const priorityButton = priorityLabel.parent;

    if (!priorityButton) {
      throw new Error('Priority button not found');
    }

    act(() => {
      priorityButton.props.onPress();
    });

    const delegateButton = findPressableWithText(root, 'inbox.delegate');

    if (!delegateButton) {
      throw new Error('Delegate button not found');
    }

    act(() => {
      delegateButton.props.onPress();
    });

    const whoInput = root.findByProps({ placeholder: 'process.delegateWhoPlaceholder' });

    act(() => {
      whoInput.props.onChangeText('Alex');
    });

    const nextTaskLabel = findNodeWithText(root, 'Next task →');
    const nextTaskButton = nextTaskLabel.parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'waiting',
        assignedTo: 'Alex',
        priority: 'urgent',
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('allows delegation without an optional assignee name', async () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = {};
    storeState.projects = [];
    storeState.areas = [];
    updateTask.mockClear();
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    chooseActionableLonger(root);
    const delegateButton = findPressableWithText(root, 'inbox.delegate');

    if (!delegateButton) {
      throw new Error('Delegate button not found');
    }

    act(() => {
      delegateButton.props.onPress();
    });

    const nextTaskLabel = findNodeWithText(root, 'Next task →');
    const nextTaskButton = nextTaskLabel.parent;

    if (!nextTaskButton) {
      throw new Error('Next task button not found');
    }

    expect(nextTaskButton.props.disabled).toBe(false);

    act(() => {
      nextTaskButton.props.onPress();
    });

    expect(updateTask).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({
        status: 'waiting',
        assignedTo: undefined,
      })
    );
    await flushAsyncActions();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a working state while AI clarify is running', async () => {
    mockSettings.features = undefined;
    mockSettings.gtd.inboxProcessing = {};
    mockSettings.ai = { enabled: true, provider: 'openai' };
    storeState.projects = [];
    storeState.areas = [];
    clarifyTask.mockReset();
    clarifyTask.mockImplementation(() => new Promise(() => {}));
    const onClose = vi.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<InboxProcessingModal visible onClose={onClose} />);
    });

    const root = tree!.root;
    const aiClarifyLabel = root.findByProps({ children: 'taskEdit.aiClarify' });
    const aiClarifyButton = aiClarifyLabel.parent;

    if (!aiClarifyButton) {
      throw new Error('AI clarify button not found');
    }

    await act(async () => {
      aiClarifyButton.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(root.findByProps({ children: 'Working...' })).toBeTruthy();
  });
});
