import { MINDWTR_CSV_COLUMNS } from './mindwtr-csv-columns';
import type { AppData, Task } from './types';

/**
 * Writes the format `mindwtr-csv-import.ts` reads, so an export can be edited in
 * a spreadsheet and imported back onto the same tasks (the ID column is always
 * written, which is what makes the re-import an update rather than a duplicate).
 *
 * TOMBSTONES ARE EXCLUDED, which diverges from `serializeBackupData` — that keeps
 * soft-deleted and purged rows because a JSON backup has to restore sync state.
 * The CSV format has no deletedAt/purgedAt column, so a tombstone could only be
 * written as an ordinary-looking row, and re-importing it would resurrect data
 * the user deleted. Structural, not a preference.
 */
export interface MindwtrCsvExportOptions {
    /** Field separator. The importer sniffs `,`/`;`/tab; comma is its default. */
    delimiter?: string;
}

const isLive = (entity: { deletedAt?: string; purgedAt?: string }): boolean => (
    !entity.deletedAt && !entity.purgedAt
);

// RFC 4180: quote when the value could otherwise break the row, double inner quotes.
const escapeCell = (value: string, delimiter: string): string => (
    new RegExp(`["\\n\\r${delimiter.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}]`, 'u').test(value)
        ? `"${value.replace(/"/gu, '""')}"`
        : value
);

const formatChecklist = (task: Task): string => (task.checklist ?? [])
    .map((item) => `[${item.isCompleted ? 'x' : ' '}] ${item.title}`)
    .join('|');

export function serializeMindwtrCsv(data: AppData, options: MindwtrCsvExportOptions = {}): string {
    const delimiter = options.delimiter ?? ',';
    const projectById = new Map(data.projects.filter(isLive).map((project) => [project.id, project]));
    const sectionById = new Map(data.sections.filter(isLive).map((section) => [section.id, section]));
    const areaById = new Map(data.areas.filter(isLive).map((area) => [area.id, area]));

    const cellsFor = (task: Task): Record<string, string> => {
        const project = task.projectId ? projectById.get(task.projectId) : undefined;
        const section = task.sectionId ? sectionById.get(task.sectionId) : undefined;
        // A task's area comes from its project when it has one; the importer
        // derives the project's area from the same column.
        const area = areaById.get(project?.areaId ?? task.areaId ?? '');
        return {
            'Title': task.title,
            'Description': task.description ?? '',
            'Status': task.status,
            'Project': project?.title ?? '',
            // A section without its project is dropped on import, so only write
            // one when the project column is populated too.
            'Section': project ? section?.title ?? '' : '',
            'Area': area?.name ?? '',
            'Contexts': (task.contexts ?? []).join(', '),
            'Tags': (task.tags ?? []).join(', '),
            'Assigned To': task.assignedTo ?? '',
            'Priority': task.priority ?? '',
            'Energy': task.energyLevel ?? '',
            'Start Date': task.startTime ?? '',
            'Due Date': task.dueDate ?? '',
            'Review Date': task.reviewAt ?? '',
            'Completed At': task.completedAt ?? '',
            'Checklist': formatChecklist(task),
            'Location': task.location ?? '',
            'Order': String(task.order ?? 0),
            'ID': task.id,
            'Created At': task.createdAt,
        };
    };

    const rows = data.tasks
        .filter(isLive)
        .map((task) => {
            const cells = cellsFor(task);
            return MINDWTR_CSV_COLUMNS.map((column) => escapeCell(cells[column] ?? '', delimiter)).join(delimiter);
        });

    return [MINDWTR_CSV_COLUMNS.join(delimiter), ...rows].join('\n');
}
