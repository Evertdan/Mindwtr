/**
 * The Mindwtr CSV column set, in the order the exporter writes them.
 *
 * The importer's accepted-column set is DERIVED from this list rather than
 * spelled out beside it, so a column added for export is automatically
 * recognised on import and the two cannot drift apart.
 *
 * Recurrence is appended rather than filed with the other scheduling columns so
 * that files written against the earlier 20-column layout keep every column at
 * the position they were built around.
 */
export const MINDWTR_CSV_COLUMNS = [
    'Title', 'Description', 'Status', 'Project', 'Section', 'Area', 'Contexts', 'Tags',
    'Assigned To', 'Priority', 'Energy', 'Start Date', 'Due Date', 'Review Date',
    'Completed At', 'Checklist', 'Location', 'Order', 'ID', 'Created At', 'Recurrence',
] as const;

export type MindwtrCsvColumn = typeof MINDWTR_CSV_COLUMNS[number];

export const MINDWTR_CSV_KNOWN_COLUMNS: ReadonlySet<string> = new Set<string>(
    MINDWTR_CSV_COLUMNS.map((column) => column.toUpperCase()),
);

/**
 * An RRULE cannot say "repeats after I complete it", so the fluid recurrence
 * strategy rides along in the Recurrence cell as an X- token, the way seriesId
 * already does inside stored rules. Absent means the default strict strategy.
 */
export const MINDWTR_CSV_FLUID_RECURRENCE_TOKEN = 'X-MINDWTR-STRATEGY=FLUID';
