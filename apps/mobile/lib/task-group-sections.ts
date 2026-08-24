import {
  buildCompletionDateSections,
  tFallback,
  type Area,
  type Project,
  type Task,
    baseTextCollator,
} from '@mindwtr/core';

/**
 * Grouping for the mobile task lists that group by a task attribute rather than
 * by project section. TaskList (Inbox, Done, Reference) and Archive both need
 * the same four axes over the same row/section shape, so the axis logic lives
 * here instead of inside whichever screen grew it first — a group rule fixed in
 * one place is otherwise a group rule still wrong in the other.
 *
 * Project-section grouping stays in task-list.tsx: it is the one arrangement
 * that is about a project's own structure rather than a task attribute, and no
 * other screen has sections to group by.
 */

export type TaskGroupBy = 'none' | 'context' | 'area' | 'project' | 'tag' | 'completedDate';

export type TaskGroupSectionItem = {
  type: 'section';
  id: string;
  title: string;
  count: number;
  muted?: boolean;
  /** Set when the caller passes `collapsedGroupIds`, so the header draws a chevron. */
  collapsible?: boolean;
  collapsed?: boolean;
};

export type TaskGroupTaskItem = {
  type: 'task';
  task: Task;
  groupId?: string;
};

export type TaskGroupItem = TaskGroupSectionItem | TaskGroupTaskItem;

/** Label for a grouping axis. Lives with the axis logic so the two cannot drift apart. */
export function getTaskGroupByLabel(groupBy: TaskGroupBy, t: (key: string) => string): string {
  switch (groupBy) {
    case 'none':
      return tFallback(t, 'list.groupByNone', 'No grouping');
    case 'context':
      return tFallback(t, 'list.groupByContext', 'Context');
    case 'area':
      return tFallback(t, 'list.groupByArea', 'Area');
    case 'project':
      return tFallback(t, 'taskEdit.projectLabel', 'Project');
    case 'tag':
      return tFallback(t, 'taskEdit.tagsLabel', 'Tags');
    case 'completedDate':
      return tFallback(t, 'list.groupByCompletedDate', 'Completion date');
    default:
      return groupBy;
  }
}

export type BuildTaskGroupSectionsParams = {
  groupBy: TaskGroupBy;
  /** Already filtered and sorted; grouping preserves the order within each group. */
  tasks: Task[];
  areas: Area[];
  projectById: Map<string, Project>;
  t: (key: string) => string;
  /**
   * Clock for the completedDate axis. Passed in so callers that re-derive on a
   * local-day change control the boundary rather than each call inventing its own.
   */
  now?: Date;
  /**
   * Groups the caller has folded. Passing the set (even empty) is what makes the
   * headers collapsible; a folded group keeps its header and its count but
   * contributes no task rows, so the rows also leave the id list the screens
   * feed to selection and range select (#970).
   */
  collapsedGroupIds?: ReadonlySet<string>;
};

/**
 * Flattens tasks into an alternating section-header / task-row list for a
 * FlatList. Empty groups are dropped, so a section header always has rows
 * under it, and the muted catch-all section ("No project", "General", …) is
 * always last — leading with the ungrouped pile pushed every real group below
 * a scroll (#963).
 */
export function buildTaskGroupSections({
  groupBy,
  tasks,
  areas,
  projectById,
  t,
  now,
  collapsedGroupIds,
}: BuildTaskGroupSectionsParams): TaskGroupItem[] {
  const appendSection = (items: TaskGroupItem[], id: string, title: string, tasksForGroup: Task[], muted = false) => {
    if (tasksForGroup.length === 0) return;
    const collapsed = collapsedGroupIds?.has(id) === true;
    items.push({
      type: 'section',
      id,
      title,
      count: tasksForGroup.length,
      muted,
      ...(collapsedGroupIds ? { collapsible: true, collapsed } : {}),
    });
    if (collapsed) return;
    tasksForGroup.forEach((task) => items.push({ type: 'task', task, groupId: id }));
  };

  if (groupBy === 'project') {
    const grouped = new Map<string, Task[]>();
    const noProjectTasks: Task[] = [];

    tasks.forEach((task) => {
      if (!task.projectId) {
        noProjectTasks.push(task);
        return;
      }
      const project = projectById.get(task.projectId);
      if (!project) {
        noProjectTasks.push(task);
        return;
      }
      const items = grouped.get(project.id) ?? [];
      items.push(task);
      grouped.set(project.id, items);
    });

    const items: TaskGroupItem[] = [];
    const sortedProjects = [...grouped.keys()]
      .map((itemProjectId) => projectById.get(itemProjectId))
      .filter((project): project is Project => Boolean(project))
      .sort((a, b) => {
        const aOrder = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
        const bOrder = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.title.localeCompare(b.title);
      });
    sortedProjects.forEach((project) => appendSection(items, `project:${project.id}`, project.title, grouped.get(project.id) ?? []));
    appendSection(items, 'project:none', tFallback(t, 'taskEdit.noProjectOption', 'No project'), noProjectTasks, true);
    return items;
  }

  if (groupBy === 'completedDate') {
    // Buckets and labels live in core so Done/Archive read the same on both
    // platforms (#959).
    const items: TaskGroupItem[] = [];
    buildCompletionDateSections({ tasks, t, now }).forEach((section) => {
      appendSection(items, section.id, section.title, section.tasks, section.muted);
    });
    return items;
  }

  if (groupBy === 'context') {
    // Mirrors Desktop's groupTasksByContext (next-grouping.ts): a task with
    // several contexts appears under each of them, catch-all last.
    const grouped = new Map<string, Task[]>();
    const noContextTasks: Task[] = [];

    tasks.forEach((task) => {
      const contexts = (task.contexts ?? [])
        .map((context) => context.trim())
        .filter((context) => context.length > 0);
      if (contexts.length === 0) {
        noContextTasks.push(task);
        return;
      }
      Array.from(new Set(contexts)).forEach((context) => {
        const items = grouped.get(context) ?? [];
        items.push(task);
        grouped.set(context, items);
      });
    });

    const items: TaskGroupItem[] = [];
    [...grouped.keys()]
      .sort((a, b) => baseTextCollator.compare(a, b))
      .forEach((context) => appendSection(items, `context:${context}`, context, grouped.get(context) ?? []));
    appendSection(items, 'context:none', tFallback(t, 'contexts.none', 'No context'), noContextTasks, true);
    return items;
  }

  if (groupBy === 'tag') {
    const grouped = new Map<string, Task[]>();
    const noTagTasks: Task[] = [];

    tasks.forEach((task) => {
      const tags = (task.tags ?? [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
      if (tags.length === 0) {
        noTagTasks.push(task);
        return;
      }
      // A task with several tags appears under each of them, so the counts sum
      // to more than the task total by design.
      Array.from(new Set(tags)).forEach((tag) => {
        const items = grouped.get(tag) ?? [];
        items.push(task);
        grouped.set(tag, items);
      });
    });

    const items: TaskGroupItem[] = [];
    [...grouped.keys()]
      .sort((a, b) => baseTextCollator.compare(a, b))
      .forEach((tag) => appendSection(items, `tag:${tag}`, tag, grouped.get(tag) ?? []));
    appendSection(items, 'tag:none', tFallback(t, 'taskEdit.noTags', 'No tags'), noTagTasks, true);
    return items;
  }

  const activeAreas = [...areas].filter((area) => !area.deletedAt).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });
  const areaIds = new Set(activeAreas.map((area) => area.id));
  const grouped = new Map<string, Task[]>();
  const generalTasks: Task[] = [];

  tasks.forEach((task) => {
    const projectAreaId = task.projectId ? projectById.get(task.projectId)?.areaId : undefined;
    const resolvedAreaId = task.areaId || projectAreaId;
    if (resolvedAreaId && areaIds.has(resolvedAreaId)) {
      const items = grouped.get(resolvedAreaId) ?? [];
      items.push(task);
      grouped.set(resolvedAreaId, items);
    } else {
      generalTasks.push(task);
    }
  });

  const items: TaskGroupItem[] = [];
  activeAreas.forEach((area) => {
    const tasksForArea = grouped.get(area.id) ?? [];
    appendSection(items, area.id, area.name, tasksForArea);
  });
  appendSection(items, 'general', tFallback(t, 'settings.general', 'General'), generalTasks, true);
  return items;
}
