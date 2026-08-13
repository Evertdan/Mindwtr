import { describe, expect, it } from 'vitest';

import { serializeMindwtrCsv } from './mindwtr-csv-export';
import { MINDWTR_CSV_COLUMNS, MINDWTR_CSV_KNOWN_COLUMNS } from './mindwtr-csv-columns';
import { applyMindwtrCsvImport, parseMindwtrCsvImportSource } from './mindwtr-csv-import';
import type { AppData, Project, Section, Task } from './types';

const task = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Draft launch email',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
} as Task);

const project = (overrides: Partial<Project> = {}): Project => ({
    id: 'project-1',
    title: 'Marketing',
    color: '#000000',
    status: 'active',
    order: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
} as Project);

const appData = (overrides: Partial<AppData> = {}): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
    ...overrides,
});

const reimport = (csv: string) => {
    const result = parseMindwtrCsvImportSource({ fileName: 'export.csv', text: csv });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    return result.parsedData!;
};

describe('serializeMindwtrCsv', () => {
    it('writes the documented header, and the importer accepts every column of it', () => {
        const header = serializeMindwtrCsv(appData()).split('\n')[0];

        expect(header).toBe(MINDWTR_CSV_COLUMNS.join(','));
        // The column table is shared, so an export can never emit a header the
        // importer would count as unknown.
        for (const column of MINDWTR_CSV_COLUMNS) {
            expect(MINDWTR_CSV_KNOWN_COLUMNS.has(column.toUpperCase())).toBe(true);
        }
    });

    it('round-trips every field the importer preserves', () => {
        const data = appData({
            areas: [{ id: 'area-1', name: 'Work', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }] as AppData['areas'],
            projects: [project({ areaId: 'area-1' })],
            sections: [{ id: 'section-1', projectId: 'project-1', title: 'Launch', order: 0, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }] as Section[],
            tasks: [task({
                projectId: 'project-1',
                sectionId: 'section-1',
                status: 'waiting',
                description: 'Multi-line\ndescription text',
                contexts: ['@phone', '@home'],
                tags: ['#urgent', '#review'],
                assignedTo: 'Alex',
                priority: 'high',
                energyLevel: 'low',
                startTime: '2026-09-01',
                dueDate: '2026-09-05T14:30:00.000Z',
                reviewAt: '2026-09-10',
                location: 'Office',
                order: 5,
                checklist: [
                    { id: 'c1', title: 'Draft copy', isCompleted: true },
                    { id: 'c2', title: 'Get approval', isCompleted: false },
                ],
            })],
        });

        const parsed = reimport(serializeMindwtrCsv(data));

        expect(parsed.areas).toMatchObject([{ name: 'Work' }]);
        expect(parsed.projects).toMatchObject([{ name: 'Marketing' }]);
        expect(parsed.sections).toMatchObject([{ name: 'Launch' }]);
        expect(parsed.tasks).toHaveLength(1);
        expect(parsed.tasks[0]).toMatchObject({
            title: 'Draft launch email',
            description: 'Multi-line\ndescription text',
            status: 'waiting',
            contexts: ['@phone', '@home'],
            tags: ['#urgent', '#review'],
            assignedTo: 'Alex',
            priority: 'high',
            energyLevel: 'low',
            reviewAt: '2026-09-10',
            location: 'Office',
            order: 5,
            createdAt: '2026-08-01T09:00:00.000Z',
            sourceIdentityKind: 'explicit-id',
            sourceId: 'task-1',
        });
        expect(parsed.tasks[0].checklist).toMatchObject([
            { title: 'Draft copy', isCompleted: true },
            { title: 'Get approval', isCompleted: false },
        ]);
        // Date-only stays date-only; a datetime keeps its instant (#797).
        expect(parsed.tasks[0].startTime).toBe('2026-09-01');
        expect(new Date(parsed.tasks[0].dueDate!).toISOString()).toBe('2026-09-05T14:30:00.000Z');
    });

    // D1: the previous version of this test only checked the PARSE output, so it proved the
    // parser was deterministic and never that importing an export leaves the task count alone.
    // Round-trip through applyMindwtrCsvImport or it proves nothing.
    it('re-imports an export onto the same tasks instead of duplicating them', () => {
        const data = appData({ tasks: [task({ id: 'stable-id' }), task({ id: 'other-id', title: 'Second' })] });

        const result = applyMindwtrCsvImport(data, reimport(serializeMindwtrCsv(data)));

        expect(result.data.tasks).toHaveLength(2);
        expect(result.data.tasks.map((item) => item.id).sort()).toEqual(['other-id', 'stable-id']);
    });

    // The importer is add-only: an already-present id is skipped, not updated
    // (import-apply.ts's existingTaskIds check). So an edited export does NOT push the edit
    // back in — it is reported as skipped. Pinned here so the round-trip contract is explicit
    // rather than assumed; changing it to update-in-place is a product decision, not a bug fix.
    it('skips rather than duplicates a re-imported export whose fields were edited', () => {
        const data = appData({ tasks: [task({ id: 'stable-id', title: 'Before' })] });
        const edited = serializeMindwtrCsv(data).replace('Before', 'After');

        const result = applyMindwtrCsvImport(data, reimport(edited));

        expect(result.data.tasks).toHaveLength(1);
        expect(result.data.tasks[0]).toMatchObject({ id: 'stable-id', title: 'Before' });
        expect(result.warnings.join(' ')).toContain('already imported');
    });

    it('survives quotes, delimiters, newlines and CJK in text', () => {
        const title = 'Say "hello", 你好\nand more; done';
        const parsed = reimport(serializeMindwtrCsv(appData({ tasks: [task({ title, location: 'a;b,c' })] })));

        expect(parsed.tasks[0].title).toBe(title);
        expect(parsed.tasks[0].location).toBe('a;b,c');
    });

    it('round-trips through a semicolon delimiter too', () => {
        const parsed = reimport(serializeMindwtrCsv(
            appData({ tasks: [task({ title: 'Comma, inside', location: 'x;y' })] }),
            { delimiter: ';' },
        ));

        expect(parsed.tasks[0].title).toBe('Comma, inside');
        expect(parsed.tasks[0].location).toBe('x;y');
    });

    it('never exports tombstones, which the CSV format cannot represent', () => {
        const data = appData({
            tasks: [
                task({ id: 'live' }),
                task({ id: 'deleted', title: 'Soft deleted', deletedAt: '2026-08-02T00:00:00.000Z' }),
                task({ id: 'purged', title: 'Purged', deletedAt: '2026-08-02T00:00:00.000Z', purgedAt: '2026-08-03T00:00:00.000Z' }),
            ],
        });

        const parsed = reimport(serializeMindwtrCsv(data));

        // Otherwise re-importing an export would resurrect deleted tasks.
        expect(parsed.tasks.map((item) => item.sourceId)).toEqual(['live']);
    });

    it('drops a section whose project was deleted, matching what import would do', () => {
        const data = appData({
            projects: [project({ deletedAt: '2026-08-02T00:00:00.000Z' })],
            sections: [{ id: 'section-1', projectId: 'project-1', title: 'Launch', order: 0, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }] as Section[],
            tasks: [task({ projectId: 'project-1', sectionId: 'section-1' })],
        });

        const parsed = reimport(serializeMindwtrCsv(data));

        expect(parsed.projects).toEqual([]);
        expect(parsed.sections).toEqual([]);
        expect(parsed.tasks[0].projectSourceKey).toBeUndefined();
    });
});
