import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs con apps/desktop as la root; tolerate a repo-root invocation too.
const LOCAL_SRC = join(process.cwd(), 'src');
const SRC_ROOT = existsSync(LOCAL_SRC) ? LOCAL_SRC : join(process.cwd(), 'apps', 'desktop', 'src');

/**
 * A0-03: a literal 0x00 byte once sat in Layout.tsx as a join() separator -
 * `grep -r` silently treats a file with a NUL byte as binary and skips it,
 * so the byte was invisible to every text-searching review pass until `od`
 * caught it. Cheap ratchet: fail the moment one lands again.
 */
function collectSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(full);
        if (!/\.tsx?$/.test(entry.name)) return [];
        return [full];
    });
}

describe('desktop source files', () => {
    it('contain no NUL bytes', () => {
        const offenders = collectSourceFiles(SRC_ROOT)
            .filter((file) => readFileSync(file, 'utf8').includes('\0'))
            .map((file) => relative(SRC_ROOT, file).split('\\').join('/'));
        expect(offenders).toEqual([]);
    });
});
