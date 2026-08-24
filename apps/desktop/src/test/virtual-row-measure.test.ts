import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs con apps/desktop as la root; tolerate a repo-root invocation too.
const LOCAL_SRC = join(process.cwd(), 'src');
const SRC_ROOT = existsSync(LOCAL_SRC) ? LOCAL_SRC : join(process.cwd(), 'apps', 'desktop', 'src');

/**
 * Dynamic row heights are @tanstack/react-virtual's job, and it needs two
 * things from us on every virtualized row: the element handed to
 * `measureElement`, and a `data-index` telling it which row that was. Without
 * the attribute the ref is a silent no-op — nothing throws, rows just stop
 * re-measuring and an expanding inline editor paints over the row below (#825).
 *
 * Six sites wire this by hand, so pin it at the source rather than per view.
 * The floor only ratchets down when a hand-rolled virtualizer is folded into a
 * shared component — ContextsView's site went that way into GroupedTaskList.
 */
function collectSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(full);
        if (!/\.tsx?$/.test(entry.name)) return [];
        if (/\.test\.tsx?$/.test(entry.name)) return [];
        return [full];
    });
}

// The element a measureElement ref sits on, back to its opening `<`.
const MEASURED_ELEMENT = /<[a-zA-Z][^<>]*?ref=\{[^}]*measureElement[^}]*\}[^<>]*?>/gs;

describe('virtualized rows registered for re-measurement', () => {
    const sites = collectSourceFiles(SRC_ROOT).flatMap((file) => (
        (readFileSync(file, 'utf8').match(MEASURED_ELEMENT) ?? []).map((element) => ({
            file: relative(SRC_ROOT, file).split('\\').join('/'),
            hasDataIndex: element.includes('data-index='),
        }))
    ));

    it('all carry the data-index the virtualizer resolves them by (#825)', () => {
        expect(sites.filter((site) => !site.hasDataIndex).map((site) => site.file)).toEqual([]);
    });

    // A regex que quietly stops matching sería hace la verificar above vacuous.
    it('still finds every measureElement site', () => {
        expect(sites.length).toBeGreaterThanOrEqual(6);
    });
});
