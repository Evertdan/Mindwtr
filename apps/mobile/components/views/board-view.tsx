import { View, Text, ScrollView, StyleSheet, Platform, Pressable, TextInput } from 'react-native';
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture, Swipeable } from 'react-native-gesture-handler';
import { Clock3, Filter, Folder, X } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { shallow, sortTasksByBoardOrder, useTaskStore, createTaskFilterPredicate, hasActiveFilterCriteria, getUsedTaskTokens, resolveFeatureFlags, tFallback, projectMatchesAreaFilterSelection, SAVED_FILTER_NO_PROJECT_ID } from '@mindwtr/core';
import type { Task, TaskStatus, FilterCriteria } from '@mindwtr/core';
import { useToast } from '@/contexts/toast-context';
import { useVisibleTaskContext } from '@/hooks/use-visible-tasks';
import { useThemeColors, type ThemeColors } from '@/hooks/use-theme-colors';
import { openContextsScreen, openProjectScreen, openTaskScreen } from '@/lib/task-meta-navigation';

import { useLanguage } from '../../contexts/language-context';
import { TaskEditModal } from '../task-edit-modal';
import { BOARD_DUE_DATE_PRESETS, countActiveBoardFilters, resolveBoardColumnReorder, resolveBoardDropColumnIndex, resolveBoardDropColumnIndexFromY, toggleCriteriaDuePreset, toggleCriteriaToken, type BoardDuePreset } from './board-view.utils';

const COLUMNS: { id: TaskStatus; label: string; labelKey: string }[] = [
  { id: 'inbox', label: 'Inbox', labelKey: 'status.inbox' },
  { id: 'next', label: 'Next', labelKey: 'status.next' },
  { id: 'waiting', label: 'Waiting', labelKey: 'status.waiting' },
  { id: 'someday', label: 'Someday', labelKey: 'status.someday' },
  { id: 'done', label: 'Done', labelKey: 'status.done' },
];
const BOARD_FILTER_CHIP_MAX_FONT_SCALE = 1.2;

function resolveColumnColor(status: TaskStatus, tc: ThemeColors): string {
  switch (status) {
    case 'inbox':
      return tc.text;
    case 'next':
      return tc.tint;
    case 'waiting':
      return tc.warning;
    case 'someday':
      return tc.secondaryText;
    case 'done':
      return tc.success;
    default:
      return tc.secondaryText;
  }
}

type RelativeTaskLayout = {
  columnIndex: number;
  y: number;
  height: number;
};

type ColumnLayout = {
  y: number;
  height: number;
};

type DragStartMetrics = {
  taskId: string;
  topY: number;
  height: number;
};

interface DraggableTaskProps {
  task: Task;
  tc: ThemeColors;
  currentColumnIndex: number;
  onDrop: (taskId: string, translationYDelta: number) => void;
  onDragStart: (taskId: string, columnIndex: number) => void;
  onDragMove: (absoluteY: number, translationY: number) => void;
  onDragEnd: () => void;
  onTap: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onDuplicate: (task: Task) => void;
  deleteLabel: string;
  duplicateLabel: string;
  dragScrollCompensation: SharedValue<number>;
  isDragActive: boolean;
  projectTitle?: string;
  projectColor?: string;
  timeEstimatesEnabled: boolean;
  onLayout: (taskId: string, columnIndex: number, y: number, height: number) => void;
}

function DraggableTask({
  task,
  tc,
  currentColumnIndex,
  onDrop,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTap,
  onDelete,
  onDuplicate,
  deleteLabel,
  duplicateLabel,
  dragScrollCompensation,
  isDragActive,
  projectTitle,
  projectColor,
  timeEstimatesEnabled,
  onLayout,
}: DraggableTaskProps) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(1);
  const isDragging = useSharedValue(false);

  const handleDropAndEndFromGesture = useCallback((taskId: string, translationYDelta: number) => {
    onDrop(taskId, translationYDelta);
    onDragEnd();
  }, [onDrop, onDragEnd]);

  // Tap gesture for editing
  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      runOnJS(onTap)(task);
    });

  // On mobile the board columns are stacked vertically, so status drag is vertical.
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(180)
    .activeOffsetY([-12, 12])
    .failOffsetX([-24, 24])
    .onStart(() => {
      isDragging.value = true;
      scale.value = withSpring(1.05);
      zIndex.value = 1000;
      runOnJS(onDragStart)(task.id, currentColumnIndex);
    })
    .onUpdate((event) => {
      translateY.value = event.translationY;
      runOnJS(onDragMove)(event.absoluteY, event.translationY);
    })
    .onEnd((event) => {
      isDragging.value = false;
      runOnJS(handleDropAndEndFromGesture)(task.id, event.translationY);

      translateY.value = withSpring(0);
      scale.value = withSpring(1);
      zIndex.value = 1;
    });

  // Combine gestures - tap works immediately, drag requires hold
  const composedGesture = Gesture.Race(
    panGesture,
    tapGesture
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + (isDragActive ? dragScrollCompensation.value : 0) },
      { scale: scale.value },
    ],
    position: 'relative',
    zIndex: zIndex.value,
    elevation: isDragging.value ? 100 : 1,
    opacity: isDragging.value ? 0.85 : 1,
  }));

  const timeEstimateLabel = (() => {
    if (!timeEstimatesEnabled || !task.timeEstimate) return null;
    const estimate = String(task.timeEstimate);
    if (estimate.endsWith('min')) return estimate.replace('min', 'm');
    if (estimate.endsWith('hr+')) return estimate.replace('hr+', 'h+');
    if (estimate.endsWith('hr')) return estimate.replace('hr', 'h');
    return estimate;
  })();

  const resolvedProjectColor = projectColor || tc.secondaryText;
  const showMetaRow = Boolean(projectTitle) || (task.tags?.length ?? 0) > 0 || (task.contexts?.length ?? 0) > 0 || Boolean(timeEstimateLabel);

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[
          styles.taskCardContainer,
          animatedStyle,
        ]}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;
          onLayout(task.id, currentColumnIndex, y, height);
        }}
      >
        <Swipeable
          renderLeftActions={() => (
            <View style={[styles.duplicateAction, { backgroundColor: tc.bg, borderColor: tc.tint }]}>
              <Text style={[styles.duplicateActionText, { color: tc.text }]}>{duplicateLabel}</Text>
            </View>
          )}
          onSwipeableLeftOpen={() => onDuplicate(task)}
          renderRightActions={() => (
            <View style={[styles.deleteAction, { backgroundColor: tc.bg, borderColor: tc.danger }]}>
              <Text style={[styles.deleteActionText, { color: tc.text }]}>{deleteLabel}</Text>
            </View>
          )}
          onSwipeableOpen={() => onDelete(task.id)}
        >
	          <View style={[
	            styles.taskCard,
	            { backgroundColor: tc.taskItemBg, borderColor: tc.border },
	          ]}>
	            <Text style={[styles.taskTitle, { color: tc.text }]} numberOfLines={2}>
	              {task.title}
	            </Text>
              {showMetaRow && (
                <View style={styles.contextsRow}>
                  {projectTitle && (
                    <View style={[styles.projectBadge, { backgroundColor: tc.filterBg, borderColor: resolvedProjectColor }]}>
                      <Folder size={12} color={tc.text} accessible={false} />
                      <Text style={[styles.projectBadgeText, { color: tc.text }]} numberOfLines={1}>
                        {projectTitle}
                      </Text>
                    </View>
                  )}
                  {(task.tags || []).slice(0, 6).map((tag, idx) => (
                    <Text
                      key={`${tag}-${idx}`}
                      style={[
                        styles.tagChip,
                        { backgroundColor: tc.filterBg, borderColor: tc.border, color: tc.secondaryText },
                      ]}
                    >
                      {tag}
                    </Text>
                  ))}
                  {(task.contexts || []).slice(0, 6).map((ctx, idx) => (
                    <Text
                      key={`${ctx}-${idx}`}
                      style={[
                        styles.contextTag,
                        { backgroundColor: tc.filterBg, borderColor: tc.border, color: tc.secondaryText },
                      ]}
                    >
                      {ctx}
                    </Text>
                  ))}
                  {timeEstimateLabel && (
                    <View style={[styles.timeEstimateBadge, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
                      <Clock3 size={12} color={tc.secondaryText} accessible={false} />
                      <Text style={[styles.timeEstimateText, { color: tc.secondaryText }]}>{timeEstimateLabel}</Text>
                    </View>
                  )}
                </View>
              )}
	          </View>
	        </Swipeable>
	      </Animated.View>
    </GestureDetector>
  );
}

interface ColumnProps {
  columnIndex: number;
  label: string;
  color: string;
  tasks: Task[];
  tc: ThemeColors;
  isDragSourceColumn: boolean;
  onDrop: (taskId: string, translationYDelta: number) => void;
  onDragStart: (taskId: string, columnIndex: number) => void;
  onDragMove: (absoluteY: number, translationY: number) => void;
  onDragEnd: () => void;
  onTap: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onDuplicate: (task: Task) => void;
  noTasksLabel: string;
  deleteLabel: string;
  duplicateLabel: string;
  draggingTaskId: string | null;
  dragScrollCompensation: SharedValue<number>;
  projectById: Record<string, { title: string; color?: string }>;
  timeEstimatesEnabled: boolean;
  onColumnLayout: (columnIndex: number, y: number, height: number) => void;
  onColumnContentLayout: (columnIndex: number, y: number) => void;
  onTaskLayout: (taskId: string, columnIndex: number, y: number, height: number) => void;
}

function Column({
  columnIndex,
  label,
  color,
  tasks,
  tc,
  isDragSourceColumn,
  onDrop,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTap,
  onDelete,
  onDuplicate,
  noTasksLabel,
  deleteLabel,
  duplicateLabel,
  draggingTaskId,
  dragScrollCompensation,
  projectById,
  timeEstimatesEnabled,
  onColumnLayout,
  onColumnContentLayout,
  onTaskLayout,
}: ColumnProps) {
  return (
    <View style={[
      styles.column,
      isDragSourceColumn ? styles.columnDragSource : null,
      { borderTopColor: color, backgroundColor: tc.cardBg },
    ]}
    onLayout={(event) => {
      const { y, height } = event.nativeEvent.layout;
      onColumnLayout(columnIndex, y, height);
    }}>
      <View style={[styles.columnHeader, { borderBottomColor: tc.border }]}>
        <Text style={[styles.columnTitle, { color: tc.text }]}>{label}</Text>
        <View style={[styles.badge, { backgroundColor: tc.filterBg, borderColor: color }]}>
          <Text style={[styles.badgeText, { color: tc.text }]}>{tasks.length}</Text>
        </View>
      </View>
      <View
        style={styles.columnContent}
        onLayout={(event) => {
          onColumnContentLayout(columnIndex, event.nativeEvent.layout.y);
        }}
      >
        {tasks.map((task) => (
          <DraggableTask
            key={task.id}
            task={task}
            tc={tc}
            currentColumnIndex={columnIndex}
            onDrop={onDrop}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onTap={onTap}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            deleteLabel={deleteLabel}
            duplicateLabel={duplicateLabel}
            isDragActive={draggingTaskId === task.id}
            dragScrollCompensation={dragScrollCompensation}
            projectTitle={task.projectId ? projectById[task.projectId]?.title : undefined}
            projectColor={task.projectId ? projectById[task.projectId]?.color : undefined}
            timeEstimatesEnabled={timeEstimatesEnabled}
            onLayout={onTaskLayout}
          />
        ))}
        {tasks.length === 0 && (
          <View style={styles.emptyColumn}>
            <Text style={[styles.emptyText, { color: tc.secondaryText }]}>
              {noTasksLabel}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function BoardView() {
  const { tasks, projects, updateTask, deleteTask, duplicateTask, reorderBoardTasks, timeEstimatesEnabled } = useTaskStore((state) => ({
    tasks: state.tasks,
    projects: state.projects,
    updateTask: state.updateTask,
    deleteTask: state.deleteTask,
    duplicateTask: state.duplicateTask,
    reorderBoardTasks: state.reorderBoardTasks,
    timeEstimatesEnabled: resolveFeatureFlags(state.settings).timeEstimates,
  }), shallow);
  const tc = useThemeColors();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [dragSourceColumnIndex, setDragSourceColumnIndex] = useState<number | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const insets = useSafeAreaInsets();
  const boardScrollRef = useRef<ScrollView | null>(null);
  const draggingTaskIdRef = useRef<string | null>(null);
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const dragStartScrollOffsetRef = useRef(0);
  const currentDragTranslationYRef = useRef(0);
  const dragScrollCompensationRef = useRef(0);
  const dragScrollCompensationSv = useSharedValue(0);
  const autoScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const columnLayoutsRef = useRef<Record<number, ColumnLayout>>({});
  const columnContentOffsetRef = useRef<Record<number, number>>({});
  const taskLayoutsRef = useRef<Record<string, RelativeTaskLayout>>({});
  const dragStartMetricsRef = useRef<DragStartMetrics | null>(null);

  const navBarInset = Platform.OS === 'android' && insets.bottom >= 24 ? insets.bottom : 0;
  const boardContentStyle = useMemo(
    () => (navBarInset ? [styles.boardContent, { paddingBottom: 16 + navBarInset }] : styles.boardContent),
    [navBarInset],
  );

  const { areaById, resolvedAreaFilter, visibleTasks } = useVisibleTaskContext();
  const sortedProjects = useMemo(() => (
    projects
      .filter((project) => !project.deletedAt)
      .filter((project) => projectMatchesAreaFilterSelection(project, resolvedAreaFilter, areaById))
      .sort((a, b) => a.title.localeCompare(b.title))
  ), [projects, resolvedAreaFilter, areaById]);
  const projectById = useMemo(() => {
    return projects.reduce((acc, project) => {
      const projectColor = project.areaId ? areaById.get(project.areaId)?.color : undefined;
      acc[project.id] = { title: project.title, color: projectColor };
      return acc;
    }, {} as Record<string, { title: string; color?: string }>);
  }, [projects, areaById]);

  // Tasks visible after the global area filter, before the board-level filter bar.
  const areaActiveTasks = useMemo(
    () => visibleTasks.filter((task) => task.status !== 'reference'),
    [visibleTasks],
  );

  const allTokens = useMemo(
    () => getUsedTaskTokens(areaActiveTasks, (task) => [...(task.contexts || []), ...(task.tags || [])]),
    [areaActiveTasks],
  );

  const filtersActive = hasActiveFilterCriteria(criteria);
  const searchActive = searchQuery.trim().length > 0;
  const boardFiltersActive = filtersActive || searchActive;
  const activeFilterCount = countActiveBoardFilters(criteria);
  const boardActiveFilterCount = activeFilterCount + (searchActive ? 1 : 0);
  const selectedProjectIds = criteria.projects ?? [];

  const criteriaFilteredTasks = useMemo(() => {
    const now = new Date();
    return filtersActive
      ? areaActiveTasks.filter(createTaskFilterPredicate(criteria, { projects, now }))
      : areaActiveTasks;
  }, [areaActiveTasks, criteria, filtersActive, projects]);
  const normalizedSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  // Apply the board filter bar (search / contexts / tags / dates / projects) and group by status.
  const tasksByStatus = useMemo(() => {
    const visibleTasks = normalizedSearch
      ? criteriaFilteredTasks.filter((task) => task.title.toLowerCase().includes(normalizedSearch))
      : criteriaFilteredTasks;
    const grouped: Record<string, Task[]> = {};
    COLUMNS.forEach(col => {
      grouped[col.id] = sortTasksByBoardOrder(visibleTasks.filter(t => t.status === col.id));
    });
    return grouped;
  }, [criteriaFilteredTasks, normalizedSearch]);

  const handleToggleToken = useCallback((token: string) => {
    setCriteria((prev) => toggleCriteriaToken(prev, token));
  }, []);
  const handleToggleDuePreset = useCallback((preset: BoardDuePreset) => {
    setCriteria((prev) => toggleCriteriaDuePreset(prev, preset));
  }, []);
  const handleToggleProject = useCallback((projectId: string) => {
    setCriteria((prev) => {
      const current = prev.projects ?? [];
      const next = current.includes(projectId)
        ? current.filter((item) => item !== projectId)
        : [...current, projectId];
      return { ...prev, projects: next.length > 0 ? next : undefined };
    });
  }, []);
  const clearFilters = useCallback(() => {
    setCriteria({});
    setSearchQuery('');
  }, []);
  const clearSearch = useCallback(() => setSearchQuery(''), []);

  const getTaskTopInContent = useCallback((taskId: string): number | null => {
    const taskLayout = taskLayoutsRef.current[taskId];
    if (!taskLayout) return null;
    const columnLayout = columnLayoutsRef.current[taskLayout.columnIndex];
    if (!columnLayout) return null;
    const columnContentOffset = columnContentOffsetRef.current[taskLayout.columnIndex] ?? 0;
    return columnLayout.y + columnContentOffset + taskLayout.y;
  }, []);

  const getColumnBounds = useCallback(() => {
    const bounds = COLUMNS.map((_, index) => {
      const layout = columnLayoutsRef.current[index];
      if (!layout) return null;
      return {
        index,
        top: layout.y,
        bottom: layout.y + layout.height,
      };
    }).filter((item): item is { index: number; top: number; bottom: number } => item !== null);
    return bounds;
  }, []);

  const handleColumnLayout = useCallback((columnIndex: number, y: number, height: number) => {
    columnLayoutsRef.current[columnIndex] = { y, height };
  }, []);

  const handleColumnContentLayout = useCallback((columnIndex: number, y: number) => {
    columnContentOffsetRef.current[columnIndex] = y;
  }, []);

  const handleTaskLayout = useCallback((taskId: string, columnIndex: number, y: number, height: number) => {
    taskLayoutsRef.current[taskId] = { columnIndex, y, height };
  }, []);

  const handleDrop = useCallback((taskId: string, translationYDelta: number) => {
    const effectiveTranslationY = translationYDelta + dragScrollCompensationRef.current;
    const currentTask = tasks.find((item) => item.id === taskId);
    const currentStatus = currentTask?.status;
    const currentColumnIndex = COLUMNS.findIndex((column) => column.id === currentStatus);
    if (currentColumnIndex < 0) return;

    let newColumnIndex = currentColumnIndex;
    let dragCenterY: number | null = null;
    const dragStartMetrics = dragStartMetricsRef.current;
    if (dragStartMetrics?.taskId === taskId) {
      dragCenterY = dragStartMetrics.topY + effectiveTranslationY + (dragStartMetrics.height / 2);
      const columnBounds = getColumnBounds();
      if (columnBounds.length > 0) {
        newColumnIndex = resolveBoardDropColumnIndexFromY({
          dragCenterY,
          currentColumnIndex,
          columnBounds,
        });
      } else {
        newColumnIndex = resolveBoardDropColumnIndex({
          translationX: effectiveTranslationY,
          currentColumnIndex,
          columnCount: COLUMNS.length,
        });
      }
    } else {
      newColumnIndex = resolveBoardDropColumnIndex({
        translationX: effectiveTranslationY,
        currentColumnIndex,
        columnCount: COLUMNS.length,
      });
    }

    if (newColumnIndex < 0 || newColumnIndex >= COLUMNS.length) return;

    if (newColumnIndex === currentColumnIndex) {
      if (dragCenterY === null || !currentStatus) return;
      const columnTaskLayouts = (tasksByStatus[currentStatus] || [])
        .map((columnTask) => {
          const top = getTaskTopInContent(columnTask.id);
          const height = taskLayoutsRef.current[columnTask.id]?.height;
          if (top === null || typeof height !== 'number' || !Number.isFinite(height)) return null;
          return { id: columnTask.id, top, height };
        })
        .filter((item): item is { id: string; top: number; height: number } => item !== null);
      const orderedIds = resolveBoardColumnReorder({
        taskId,
        dragCenterY,
        columnTasks: columnTaskLayouts,
      });
      if (orderedIds) {
        void reorderBoardTasks(currentStatus, orderedIds);
      }
      return;
    }

    const newStatus = COLUMNS[newColumnIndex].id;
    updateTask(taskId, { status: newStatus });
  }, [getColumnBounds, getTaskTopInContent, reorderBoardTasks, tasks, tasksByStatus, updateTask]);

  const handleTap = useCallback((task: Task) => {
    setEditingTask(task);
  }, []);

  const handleSave = useCallback((taskId: string, updates: Partial<Task>) => {
    return updateTask(taskId, updates);
  }, [updateTask]);

  const handleDelete = useCallback((taskId: string) => {
    deleteTask(taskId);
  }, [deleteTask]);

  const handleDuplicate = useCallback(async (task: Task) => {
    try {
      const result = await duplicateTask(task.id, false);
      if (!result.success || !result.id) {
        showToast({
          title: tFallback(t, 'common.error', 'Error'),
          message: result.error || t('task.duplicateFailed'),
          tone: 'error',
        });
        return;
      }
      openTaskScreen(result.id, task.projectId, 'task');
    } catch {
      showToast({
        title: tFallback(t, 'common.error', 'Error'),
        message: t('task.duplicateFailed'),
        tone: 'error',
      });
    }
  }, [duplicateTask, showToast, t]);

  const stopAutoScroll = useCallback(() => {
    autoScrollDirectionRef.current = 0;
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback((direction: -1 | 1) => {
    if (autoScrollDirectionRef.current === direction && autoScrollIntervalRef.current) {
      return;
    }
    stopAutoScroll();
    autoScrollDirectionRef.current = direction;
    autoScrollIntervalRef.current = setInterval(() => {
      const maxOffset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
      if (maxOffset <= 0) {
        stopAutoScroll();
        return;
      }
      const edgeDistanceTop = currentDragTranslationYRef.current;
      const speed = Math.max(6, Math.min(14, Math.floor(Math.abs(edgeDistanceTop) / 24)));
      const nextOffset = Math.max(0, Math.min(maxOffset, scrollOffsetRef.current + (direction * speed)));
      if (nextOffset === scrollOffsetRef.current) {
        stopAutoScroll();
        return;
      }
      scrollOffsetRef.current = nextOffset;
      if (draggingTaskIdRef.current) {
        const nextCompensation = nextOffset - dragStartScrollOffsetRef.current;
        dragScrollCompensationRef.current = nextCompensation;
        dragScrollCompensationSv.value = nextCompensation;
      }
      boardScrollRef.current?.scrollTo({ y: nextOffset, animated: false });
    }, 16);
  }, [dragScrollCompensationSv, stopAutoScroll]);

  const handleDragStart = useCallback((taskId: string, columnIndex: number) => {
    setDraggingTaskId(taskId);
    draggingTaskIdRef.current = taskId;
    setDragSourceColumnIndex(columnIndex);
    dragStartScrollOffsetRef.current = scrollOffsetRef.current;
    currentDragTranslationYRef.current = 0;
    dragScrollCompensationRef.current = 0;
    dragScrollCompensationSv.value = 0;
    const dragTaskHeight = taskLayoutsRef.current[taskId]?.height;
    const dragTaskTopY = getTaskTopInContent(taskId);
    if (
      dragTaskTopY !== null &&
      Number.isFinite(dragTaskHeight) &&
      typeof dragTaskHeight === 'number' &&
      dragTaskHeight > 0
    ) {
      dragStartMetricsRef.current = {
        taskId,
        topY: dragTaskTopY,
        height: dragTaskHeight,
      };
    } else {
      dragStartMetricsRef.current = null;
    }
    stopAutoScroll();
  }, [dragScrollCompensationSv, getTaskTopInContent, stopAutoScroll]);

  const handleDragMove = useCallback((absoluteY: number, translationY: number) => {
    currentDragTranslationYRef.current = translationY;
    const viewportHeight = viewportHeightRef.current;
    if (viewportHeight <= 0) return;
    const edgeThreshold = 72;
    if (absoluteY <= edgeThreshold) {
      startAutoScroll(-1);
      return;
    }
    if (absoluteY >= (viewportHeight - edgeThreshold)) {
      startAutoScroll(1);
      return;
    }
    stopAutoScroll();
  }, [startAutoScroll, stopAutoScroll]);

  const handleDragEnd = useCallback(() => {
    setDraggingTaskId(null);
    draggingTaskIdRef.current = null;
    setDragSourceColumnIndex(null);
    currentDragTranslationYRef.current = 0;
    dragScrollCompensationRef.current = 0;
    dragScrollCompensationSv.value = 0;
    dragStartMetricsRef.current = null;
    stopAutoScroll();
  }, [dragScrollCompensationSv, stopAutoScroll]);

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  useEffect(() => {
    const liveTaskIds = new Set(tasks.map((task) => task.id));
    for (const taskId of Object.keys(taskLayoutsRef.current)) {
      if (!liveTaskIds.has(taskId)) {
        delete taskLayoutsRef.current[taskId];
      }
    }
    if (dragStartMetricsRef.current && !liveTaskIds.has(dragStartMetricsRef.current.taskId)) {
      dragStartMetricsRef.current = null;
    }
  }, [tasks]);

  return (
    <View style={[styles.container, { backgroundColor: tc.bg }]}>
      <View style={[styles.filterBar, { borderBottomColor: tc.border }]}>
        <View style={styles.filterBarHeader}>
          <Pressable
            onPress={() => setFiltersOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersOpen }}
            style={[
              styles.filterToggle,
              {
                backgroundColor: boardFiltersActive ? tc.tint : tc.filterBg,
                borderColor: boardFiltersActive ? tc.tint : tc.border,
              },
            ]}
          >
            <Filter size={14} color={boardFiltersActive ? tc.onTint : tc.secondaryText} />
            <Text style={[styles.filterToggleText, { color: boardFiltersActive ? tc.onTint : tc.text }]}>
              {t('filters.label')}{boardActiveFilterCount > 0 ? ` (${boardActiveFilterCount})` : ''}
            </Text>
          </Pressable>
          {boardFiltersActive && (
            <Pressable onPress={clearFilters} accessibilityRole="button" hitSlop={8}>
              <Text style={[styles.filterClearText, { color: tc.tint }]}>{t('filters.clear')}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('common.search')}
            placeholderTextColor={tc.secondaryText}
            accessibilityLabel={t('common.search')}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[
              styles.searchInput,
              searchActive ? styles.searchInputWithClear : null,
              {
                backgroundColor: searchActive ? tc.filterBg : tc.inputBg,
                borderColor: searchActive ? tc.tint : tc.border,
                color: tc.text,
              },
            ]}
          />
          {searchActive && (
            <Pressable
              onPress={clearSearch}
              accessibilityRole="button"
              accessibilityLabel={t('filters.clear')}
              hitSlop={8}
              style={[styles.searchClearButton, { backgroundColor: tc.cardBg }]}
            >
              <X size={16} color={tc.secondaryText} />
            </Pressable>
          )}
        </View>
        {filtersOpen && (
          <View style={styles.filterPanel}>
            {allTokens.length > 0 && (
              <View style={styles.filterSection}>
                <Text style={[styles.filterSectionTitle, { color: tc.secondaryText }]}>{t('filters.contexts')}</Text>
                <View style={styles.filterChipRow}>
                  {allTokens.map((token) => {
                    const selected = token.trim().startsWith('#')
                      ? (criteria.tags ?? []).includes(token)
                      : (criteria.contexts ?? []).includes(token);
                    return (
                      <Pressable
                        key={`token:${token}`}
                        onPress={() => handleToggleToken(token)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: selected ? tc.tint : tc.filterBg,
                            borderColor: selected ? tc.tint : tc.border,
                          },
                        ]}
                      >
                        <Text
                          maxFontSizeMultiplier={BOARD_FILTER_CHIP_MAX_FONT_SCALE}
                          style={[styles.filterChipText, { color: selected ? tc.onTint : tc.text }]}
                        >
                          {token}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: tc.secondaryText }]}>{t('search.due.label')}</Text>
              <View style={styles.filterChipRow}>
                {BOARD_DUE_DATE_PRESETS.map((preset) => {
                  const selected = !!criteria.dueDateRange
                    && 'preset' in criteria.dueDateRange
                    && criteria.dueDateRange.preset === preset;
                  return (
                    <Pressable
                      key={`due:${preset}`}
                      onPress={() => handleToggleDuePreset(preset)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: selected ? tc.tint : tc.filterBg,
                          borderColor: selected ? tc.tint : tc.border,
                        },
                      ]}
                    >
                      <Text
                        maxFontSizeMultiplier={BOARD_FILTER_CHIP_MAX_FONT_SCALE}
                        style={[styles.filterChipText, { color: selected ? tc.onTint : tc.text }]}
                      >
                        {t(`filters.datePreset.${preset}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: tc.secondaryText }]}>{t('filters.projects')}</Text>
              <View style={styles.filterChipRow}>
                {(() => {
                  const selected = selectedProjectIds.includes(SAVED_FILTER_NO_PROJECT_ID);
                  return (
                    <Pressable
                      key={`project:${SAVED_FILTER_NO_PROJECT_ID}`}
                      onPress={() => handleToggleProject(SAVED_FILTER_NO_PROJECT_ID)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: selected ? tc.tint : tc.filterBg,
                          borderColor: selected ? tc.tint : tc.border,
                        },
                      ]}
                    >
                      <Text
                        maxFontSizeMultiplier={BOARD_FILTER_CHIP_MAX_FONT_SCALE}
                        style={[styles.filterChipText, { color: selected ? tc.onTint : tc.text }]}
                      >
                        {t('taskEdit.noProjectOption')}
                      </Text>
                    </Pressable>
                  );
                })()}
                {sortedProjects.map((project) => {
                  const selected = selectedProjectIds.includes(project.id);
                  const projectColor = project.areaId ? areaById.get(project.areaId)?.color : undefined;
                  return (
                    <Pressable
                      key={`project:${project.id}`}
                      onPress={() => handleToggleProject(project.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.filterChip,
                        styles.projectFilterChip,
                        {
                          backgroundColor: selected ? tc.tint : tc.filterBg,
                          borderColor: selected ? tc.tint : tc.border,
                        },
                      ]}
                    >
                      <View style={[styles.projectFilterDot, { backgroundColor: projectColor || tc.secondaryText }]} />
                      <Text
                        maxFontSizeMultiplier={BOARD_FILTER_CHIP_MAX_FONT_SCALE}
                        style={[styles.filterChipText, styles.projectFilterText, { color: selected ? tc.onTint : tc.text }]}
                        numberOfLines={1}
                      >
                        {project.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </View>
      <ScrollView
        ref={boardScrollRef}
        showsVerticalScrollIndicator={false}
        style={styles.boardScroll}
        contentContainerStyle={boardContentStyle}
        onLayout={(event) => {
          viewportHeightRef.current = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w, h) => {
          contentHeightRef.current = h;
        }}
        onScroll={(event) => {
          const nextOffset = event.nativeEvent.contentOffset.y;
          scrollOffsetRef.current = nextOffset;
          if (draggingTaskIdRef.current) {
            const nextCompensation = nextOffset - dragStartScrollOffsetRef.current;
            dragScrollCompensationRef.current = nextCompensation;
            dragScrollCompensationSv.value = nextCompensation;
          }
        }}
        scrollEventThrottle={16}
      >
        {COLUMNS.map((col, index) => (
          <Column
            key={col.id}
            columnIndex={index}
            label={tFallback(t, col.labelKey, col.label)}
            color={resolveColumnColor(col.id, tc)}
            tasks={tasksByStatus[col.id] || []}
            tc={tc}
            isDragSourceColumn={dragSourceColumnIndex === index}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onTap={handleTap}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            noTasksLabel={t('board.noTasks')}
            deleteLabel={t('board.delete')}
            duplicateLabel={t('taskEdit.duplicateTask')}
            draggingTaskId={draggingTaskId}
            dragScrollCompensation={dragScrollCompensationSv}
            projectById={projectById}
            timeEstimatesEnabled={timeEstimatesEnabled}
            onColumnLayout={handleColumnLayout}
            onColumnContentLayout={handleColumnContentLayout}
            onTaskLayout={handleTaskLayout}
          />
        ))}
      </ScrollView>

      {/* Task Edit Modal */}
      <TaskEditModal
        visible={!!editingTask}
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSave}
        defaultTab="view"
        onProjectNavigate={openProjectScreen}
        onContextNavigate={openContextsScreen}
        onTagNavigate={openContextsScreen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  filterBarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  filterClearText: {
    fontSize: 13,
    fontWeight: '500',
  },
  filterPanel: {
    gap: 12,
  },
  searchRow: {
    position: 'relative',
  },
  searchInput: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
  },
  searchInputWithClear: {
    paddingRight: 44,
  },
  searchClearButton: {
    position: 'absolute',
    right: 8,
    top: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSection: {
    gap: 6,
  },
  filterSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  projectFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 180,
  },
  projectFilterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectFilterText: {
    flexShrink: 1,
  },
  boardScroll: {
    flex: 1,
  },
  boardContent: {
    padding: 16,
    gap: 16,
    overflow: 'visible',
  },
  column: {
    width: '100%',
    borderRadius: 12,
    borderTopWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    minHeight: 100,
    overflow: 'visible',
  },
  columnDragSource: {
    zIndex: 500,
    elevation: 500,
  },
  columnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
  },
  columnTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  columnContent: {
    padding: 10,
    minHeight: 50,
    overflow: 'visible',
  },
  emptyColumn: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyText: {
    fontSize: 13,
  },
  taskCard: {
    borderRadius: 8,
    padding: 12,
    // marginBottom removed - handled by container for swipe support
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
  },
  taskCardContainer: {
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'visible',
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    flex: 1,
    paddingRight: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
  deleteActionText: {
    fontWeight: '600',
    fontSize: 14,
  },
  duplicateAction: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    flex: 1,
    paddingLeft: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
  duplicateActionText: {
    fontWeight: '600',
    fontSize: 14,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  contextsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  projectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  projectBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  contextTag: {
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    lineHeight: 14,
    borderWidth: 1,
  },
  tagChip: {
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    lineHeight: 14,
    borderWidth: 1,
  },
  timeEstimateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  timeEstimateText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
});
