import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import {
    appendWarning,
    assertImportChecklistItemCount,
    assertImportSourceFileSize,
    basename,
    buildHeaderIndex,
    createImportArchiveBudget,
    dedupeStrings,
    detectDelimiter,
    DEFAULT_IMPORT_CSV_LIMITS,
    getCell,
    isZipBytes,
    ImportSourceLimitError,
    joinDescription,
    normalizeHeaderCell,
    parseCsvRows,
    readImportSource,
    sanitizeCsvText,
    sanitizeJsonText,
    toImportBytes,
    type ImportSourceLimits,
    type ImportCsvLimits,
} from './import-source-reader';

const TEST_LIMITS: ImportSourceLimits = {
    maxArchiveEntries: 2,
    maxArchiveEntryBytes: 64,
    maxArchiveExpandedBytes: 96,
    maxInputBytes: 256,
    maxTextBytes: 64,
};

const TEST_CSV_LIMITS: ImportCsvLimits = {
    maxCellChars: 4,
    maxColumns: 3,
    maxRows: 2,
};

describe('import-source-reader', () => {
    it('counts checklist items without splitting them so archive budgets can precharge allocation', () => {
        const itemCount = assertImportChecklistItemCount(' first ||\n second \r\n | third ', 3);
        expect(itemCount).toBe(3);

        const checklistBudget = createImportArchiveBudget({ maxChecklistItems: 3, maxEntities: 10, maxRows: 10 });
        checklistBudget.consumeChecklistItems(itemCount);
        expect(() => checklistBudget.consumeChecklistItems(
            assertImportChecklistItemCount('fourth', 3),
        )).toThrowError(/across the archive.*3 checklist/iu);
    });

    it('enforces cumulative row, entity, and checklist budgets across compact archive entries', () => {
        const rowBudget = createImportArchiveBudget({ maxChecklistItems: 2, maxEntities: 3, maxRows: 3 });
        expect(parseCsvRows('h\none', ',', TEST_CSV_LIMITS, rowBudget).rows).toHaveLength(2);
        expect(() => parseCsvRows('h\ntwo', ',', TEST_CSV_LIMITS, rowBudget))
            .toThrowError(/across the archive.*3 rows/iu);

        const entityBudget = createImportArchiveBudget({ maxChecklistItems: 2, maxEntities: 3, maxRows: 10 });
        entityBudget.consumeEntities(2);
        expect(() => entityBudget.consumeEntities(2)).toThrowError(/across the archive.*3 records/iu);

        const checklistBudget = createImportArchiveBudget({ maxChecklistItems: 2, maxEntities: 10, maxRows: 10 });
        checklistBudget.consumeChecklistItems(1);
        expect(() => checklistBudget.consumeChecklistItems(2)).toThrowError(/across the archive.*2 checklist/iu);
    });

    it('basename strips both slash styles and falls back to the whole value', () => {
        expect(basename('C:\\exports\\file.csv')).toBe('file.csv');
        expect(basename('/tmp/exports/file.csv')).toBe('file.csv');
        expect(basename('file.csv')).toBe('file.csv');
        expect(basename('')).toBe('');
    });

    it('toImportBytes normalizes ArrayBuffer/Uint8Array/null uniformly', () => {
        expect(toImportBytes(null)).toBeNull();
        expect(toImportBytes(undefined)).toBeNull();
        const bytes = new Uint8Array([1, 2, 3]);
        expect(toImportBytes(bytes)).toBe(bytes);
        expect(Array.from(toImportBytes(bytes.buffer) as Uint8Array)).toEqual([1, 2, 3]);
    });

    it('isZipBytes checks the local-file-header signature', () => {
        expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
        expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false);
        expect(isZipBytes(new Uint8Array([0, 0, 0, 0]))).toBe(false);
    });

    it('sanitizeCsvText/sanitizeJsonText strip a leading BOM, json also trims', () => {
        expect(sanitizeCsvText('\uFEFFa,b')).toBe('a,b');
        expect(sanitizeJsonText('\uFEFF  {"a":1}  ')).toBe('{"a":1}');
    });

    it('detectDelimiter prefers semicolon only when it strictly outnumbers commas', () => {
        expect(detectDelimiter('a,b,c')).toBe(',');
        expect(detectDelimiter('a;b;c')).toBe(';');
        expect(detectDelimiter('a,b;c')).toBe(','); // tie goes to comma
        expect(detectDelimiter('')).toBe(','); // default fallback
        expect(detectDelimiter('', ';')).toBe(';'); // custom fallback
    });

    it('parseCsvRows handles quoted fields, escaped quotes, and reports an unclosed quote', () => {
        const { rows, hasUnclosedQuote } = parseCsvRows('a,"b,c","d""e"\nf,g,h', ',');
        expect(rows).toEqual([
            ['a', 'b,c', 'd"e'],
            ['f', 'g', 'h'],
        ]);
        expect(hasUnclosedQuote).toBe(false);

        const unclosed = parseCsvRows('a,"b', ',');
        expect(unclosed.hasUnclosedQuote).toBe(true);
        expect(unclosed.rows).toEqual([['a', 'b']]);
    });

    // No test — old or new — pinned CRLF handling before this refactor, even though the code has
    // an explicit `\r\n` branch. Cheap to close: same fixture, `\r\n` line endings instead of `\n`.
    it('parseCsvRows treats CRLF as a single row terminator, not an extra blank row', () => {
        const { rows } = parseCsvRows('a,"b,c","d""e"\r\nf,g,h\r\n', ',');
        expect(rows).toEqual([
            ['a', 'b,c', 'd"e'],
            ['f', 'g', 'h'],
        ]);
    });

    it('parseCsvRows skips newline-only rows without retaining one array per line', () => {
        const { rows } = parseCsvRows(`${'\n'.repeat(100_000)}a,b`, ',');

        expect(rows).toEqual([['a', 'b']]);
    });

    it('parseCsvRows enforces row, column, and cell boundaries while accepting exact limits', () => {
        expect(parseCsvRows('abcd,x,y\na,b,c', ',', TEST_CSV_LIMITS).rows).toHaveLength(2);
        expect(() => parseCsvRows('abcd,x,y\na,b,c\nx,y,z', ',', TEST_CSV_LIMITS)).toThrowError(
            expect.objectContaining({ code: 'csv-too-many-rows' }),
        );
        expect(() => parseCsvRows('a,b,c,d', ',', TEST_CSV_LIMITS)).toThrowError(
            expect.objectContaining({ code: 'csv-too-many-columns' }),
        );
        expect(() => parseCsvRows('abcde', ',', TEST_CSV_LIMITS)).toThrowError(
            expect.objectContaining({ code: 'csv-cell-too-large' }),
        );
        expect(DEFAULT_IMPORT_CSV_LIMITS.maxRows).toBeGreaterThanOrEqual(5_000);
    });

    it('buildHeaderIndex/getCell resolve columns case-insensitively', () => {
        const index = buildHeaderIndex([' Title ', 'Due Date']);
        expect(normalizeHeaderCell(' Title ')).toBe('TITLE');
        expect(getCell(['Task 1', '2026-01-01'], index, 'TITLE')).toBe('Task 1');
        expect(getCell(['Task 1', '2026-01-01'], index, 'DUE DATE')).toBe('2026-01-01');
        expect(getCell(['Task 1'], index, 'MISSING')).toBe('');
    });

    it('dedupeStrings dedupes case-insensitively, keeping first-seen casing', () => {
        expect(dedupeStrings(['Work', 'work', ' WORK ', undefined, '', 'Home'])).toEqual(['Work', 'Home']);
    });

    it('joinDescription joins defined non-empty parts with a blank line', () => {
        expect(joinDescription(['first', undefined, '  ', 'second'])).toBe('first\n\nsecond');
        expect(joinDescription([undefined, '  '])).toBeUndefined();
    });

    it('appendWarning pushes nothing for zero, singular for one, formatted plural otherwise', () => {
        const warnings: string[] = [];
        appendWarning(warnings, 0, '1 thing', '{count} things');
        appendWarning(warnings, 1, '1 thing', '{count} things');
        appendWarning(warnings, 3, '1 thing', '{count} things');
        expect(warnings).toEqual(['1 thing', '3 things']);
    });

    it('readImportSource returns decoded text for a plain (non-ZIP) file', () => {
        const result = readImportSource({ fileName: 'export.csv', text: 'a,b\n1,2' });
        expect(result).toEqual({ kind: 'text', fileName: 'export.csv', text: 'a,b\n1,2' });
    });

    it('readImportSource decodes bytes with the provided decoder for a non-ZIP file', () => {
        const bytes = strToU8('hello');
        const result = readImportSource({ fileName: 'export.csv', bytes }, () => 'DECODED');
        expect(result).toEqual({ kind: 'text', fileName: 'export.csv', text: 'DECODED' });
    });

    it('readImportSource returns raw archive entries (including directories) for a ZIP file', () => {
        const archive = zipSync({
            'a.csv': strToU8('1,2'),
            'nested/': new Uint8Array(0),
            'notes.txt': strToU8('skip me'),
        });
        const result = readImportSource({ fileName: 'export.zip', bytes: archive });
        expect(result.kind).toBe('archive');
        if (result.kind !== 'archive') throw new Error('expected archive');
        expect(result.fileName).toBe('export.zip');
        const names = result.entries.map((entry) => entry.entryName).sort();
        expect(names).toEqual(['a.csv', 'nested/', 'notes.txt']);
        const csvEntry = result.entries.find((entry) => entry.entryName === 'a.csv');
        expect(new TextDecoder().decode(csvEntry?.entryBytes)).toBe('1,2');
    });

    it('rejects a platform-reported file above the input cap and accepts the exact boundary', () => {
        expect(() => assertImportSourceFileSize(TEST_LIMITS.maxInputBytes, TEST_LIMITS)).not.toThrow();
        expect(() => assertImportSourceFileSize(TEST_LIMITS.maxInputBytes + 1, TEST_LIMITS)).toThrowError(
            ImportSourceLimitError,
        );
        expect(() => assertImportSourceFileSize(TEST_LIMITS.maxInputBytes + 1, TEST_LIMITS)).toThrowError(
            expect.objectContaining({ code: 'input-too-large' }),
        );
    });

    it('rejects oversized raw bytes before decoding them', () => {
        const decode = vi.fn(() => 'decoded');

        expect(() => readImportSource(
            { fileName: 'large.csv', bytes: new Uint8Array(TEST_LIMITS.maxTextBytes + 1) },
            decode,
            TEST_LIMITS,
        )).toThrowError(expect.objectContaining({ code: 'text-too-large' }));
        expect(decode).not.toHaveBeenCalled();
    });

    it('validates selected text even when a smaller byte payload is also present', () => {
        expect(() => readImportSource(
            {
                fileName: 'selected.csv',
                bytes: strToU8('x'),
                text: 'x'.repeat(TEST_LIMITS.maxTextBytes + 1),
            },
            undefined,
            TEST_LIMITS,
        )).toThrowError(expect.objectContaining({ code: 'text-too-large' }));
    });

    it('rejects a compact ZIP whose original entry size exceeds the cap', () => {
        const entryLimit = 512;
        const archive = zipSync({
            'large.csv': new Uint8Array(entryLimit + 1).fill(65),
        }, { level: 9 });

        expect(archive.byteLength).toBeLessThan(entryLimit);
        expect(() => readImportSource(
            { fileName: 'large.zip', bytes: archive },
            undefined,
            { ...TEST_LIMITS, maxArchiveEntryBytes: entryLimit },
        )).toThrowError(expect.objectContaining({ code: 'archive-entry-too-large' }));
    });

    it('caps aggregate expanded ZIP bytes and archive entry count', () => {
        const aggregateArchive = zipSync({
            'one.csv': new Uint8Array(49),
            'two.csv': new Uint8Array(48),
        });
        expect(() => readImportSource(
            { fileName: 'aggregate.zip', bytes: aggregateArchive },
            undefined,
            TEST_LIMITS,
        )).toThrowError(expect.objectContaining({ code: 'archive-expanded-too-large' }));

        const entryCountArchive = zipSync({
            'one.csv': new Uint8Array(0),
            'two.csv': new Uint8Array(0),
            'three.csv': new Uint8Array(0),
        });
        expect(() => readImportSource(
            { fileName: 'many.zip', bytes: entryCountArchive },
            undefined,
            { ...TEST_LIMITS, maxInputBytes: 512 },
        )).toThrowError(expect.objectContaining({ code: 'archive-too-many-entries' }));
    });

    it('accepts archive entries and aggregate expanded bytes at their exact boundaries', () => {
        const archive = zipSync({
            'one.csv': new Uint8Array(32),
            'two.csv': new Uint8Array(64),
        });
        const result = readImportSource(
            { fileName: 'boundary.zip', bytes: archive },
            undefined,
            { ...TEST_LIMITS, maxInputBytes: 512 },
        );

        expect(result.kind).toBe('archive');
    });
});
