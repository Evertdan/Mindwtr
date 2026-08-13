/**
 * The Mindwtr CSV column set, in the order the exporter writes them.
 *
 * The importer's accepted-column set is DERIVED from this list rather than
 * spelled out beside it, so a column added for export is automatically
 * recognised on import and the two cannot drift apart.
 *
 * RECURRENCE is accepted on import (and warned about) but never written: the
 * exporter has no recurring-task representation to put there.
 */
export const MINDWTR_CSV_COLUMNS = [
    'Title', 'Description', 'Status', 'Project', 'Section', 'Area', 'Contexts', 'Tags',
    'Assigned To', 'Priority', 'Energy', 'Start Date', 'Due Date', 'Review Date',
    'Completed At', 'Checklist', 'Location', 'Order', 'ID', 'Created At',
] as const;

export type MindwtrCsvColumn = typeof MINDWTR_CSV_COLUMNS[number];

export const MINDWTR_CSV_KNOWN_COLUMNS: ReadonlySet<string> = new Set<string>([
    ...MINDWTR_CSV_COLUMNS.map((column) => column.toUpperCase()),
    'RECURRENCE',
]);
