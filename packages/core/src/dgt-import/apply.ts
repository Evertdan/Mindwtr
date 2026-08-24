import { applyImport } from '../import-apply';
import type { AppData } from '../types';
import { generateDeterministicUUID } from '../uuid';

import {
  DGT_AREA_FALLBACK,
  DGT_IMPORT_SUFFIX,
  DGT_PROJECT_FALLBACK,
  type DgtImportExecutionResult,
  type ParsedDgtImportData,
} from './shared';

const DGT_IMPORT_ID_NAMESPACE = 'mindwtr:dgt-import:v1';

// New for this refactor: DGT previously minted a fresh uuid per entity on every apply, so
// re-importing the same export duplicated everything. Deriving ids from source ids (like
// TickTick already does) gives DGT the same re-import idempotency, closing that gap.
const createDgtImportId = (kind: 'area' | 'project' | 'section' | 'task', sourceKey: string): string => (
  generateDeterministicUUID(`${DGT_IMPORT_ID_NAMESPACE}:${kind}:${sourceKey}`)
);

export const applyDgtImport = (
  currentData: AppData,
  parsedData: ParsedDgtImportData,
  options: { now?: Date | string } = {}
): DgtImportExecutionResult => {
  // Sort on the original numeric sourceId (matches the original apply()'s tie-break exactly)
  // before stringifying it into the generic sourceKey the shared idFor hook expects.
  const areas = [...parsedData.areas]
    .sort((left, right) => left.order - right.order || left.sourceId - right.sourceId)
    .map((area) => ({ ...area, sourceKey: String(area.sourceId) }));
  const projects = [...parsedData.projects]
    .sort((left, right) => left.order - right.order || left.sourceId - right.sourceId)
    .map((project) => ({
      ...project,
      areaSourceKey: project.areaSourceId !== undefined ? String(project.areaSourceId) : undefined,
      sourceKey: String(project.sourceId),
      status: project.isArchived ? ('archived' as const) : ('active' as const),
    }));
  const tasks = [...parsedData.tasks]
    .sort((left, right) => left.order - right.order || left.sourceId - right.sourceId)
    .map((task) => ({
      ...task,
      areaSourceKey: task.areaSourceId !== undefined ? String(task.areaSourceId) : undefined,
      projectSourceKey: task.projectSourceId !== undefined ? String(task.projectSourceId) : undefined,
      sourceKey: String(task.sourceId),
    }));

  return applyImport(
    currentData,
    { areas, projects, tasks, warnings: parsedData.warnings },
    {
      fallbacks: { area: DGT_AREA_FALLBACK, project: DGT_PROJECT_FALLBACK },
      idFor: createDgtImportId,
      now: options.now,
      suffix: DGT_IMPORT_SUFFIX,
    }
  );
};
