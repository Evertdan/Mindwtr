import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as barrel from './index';
import exportsBaseline from './index-exports.baseline.json';

// Three guardrails for the barrel (see the header comment in index.ts for why they exist):
//
// 1. The barrel's export-name set must never shrink below a committed snapshot. `export *`
//    growing the surface over time is expected and fine -- update index-exports.baseline.json
//    (Object.keys(await import('./index')).sort()) when that happens. A name disappearing is
//    the failure this guards against.
// 2. Cada packages/core/package.json "exports" target must exist on disk.
// 3. Cada '@mindwtr/core/<module>' subpath imported anywhere under apps/ must be reachable
//    from the barrel. Mobile's Metro resolver collapses every such subpath onto index.ts and
//    ignores package.json "exports" entirely, so a module reachable only by subpath (and not
//    re-exported here) is `undefined` at runtime on a real device even though vitest resolves
//    it fine. Seven imports broke exactly this way in one batch before this test existed.

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(srcDir, '..', '..', '..');
const packageJson = JSON.parse(readFileSync(join(srcDir, '..', 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
};

describe('barrel export surface', () => {
    it('is a superset of the committed baseline', () => {
        const currentNames = new Set(Object.keys(barrel));
        const missing = (exportsBaseline as string[]).filter((name) => !currentNames.has(name));
        expect(missing).toEqual([]);
    });
});

describe('package.json exports map', () => {
    it('points every subpath at a file that exists on disk', () => {
        const dangling = Object.entries(packageJson.exports)
            .filter(([, target]) => !existsSync(join(srcDir, '..', target)))
            .map(([subpath, target]) => `${subpath} -> ${target}`);
        expect(dangling).toEqual([]);
    });
});

// 'target', 'ios' and 'android' hold no .ts but carry ~5.5k directories of Rust/Pods/Gradle
// build output between them -- skipping them is the difference between walking 105 dirs and 5673.
const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'coverage', '.expo', '.git', '.gradle', 'target', 'ios', 'android',
]);

function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) files.push(...collectSourceFiles(join(dir, entry.name)));
            continue;
        }
        if (/\.tsx?$/.test(entry.name)) files.push(join(dir, entry.name));
    }
    return files;
}

function findImportedSubpaths(root: string): Set<string> {
    const subpaths = new Set<string>();
    const pattern = /@mindwtr\/core\/([A-Za-z0-9_/-]+)/g;
    for (const file of collectSourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(pattern)) subpaths.add(match[1]);
    }
    return subpaths;
}

describe('@mindwtr/core subpath imports under apps/', () => {
    it('are all barrel-reachable', async () => {
        const barrelNames = new Set(Object.keys(barrel));
        const subpaths = findImportedSubpaths(join(repoRoot, 'apps'));
        // Sanity check on the check itself: if this ever finds zero subpaths, the regex or the
        // apps/ directory moved and the test below would pass vacuously.
        expect(subpaths.size).toBeGreaterThan(0);

        const unreachable: string[] = [];
        for (const subpath of subpaths) {
            const base = join(srcDir, subpath);
            const modulePath = existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts');
            const moduleExports = await import(modulePath);
            for (const name of Object.keys(moduleExports)) {
                if (!barrelNames.has(name)) unreachable.push(`@mindwtr/core/${subpath}: ${name}`);
            }
        }
        expect(unreachable).toEqual([]);
    // Dynamically importing every subpath module pulls a large transitive graph through the
    // transform pipeline. On a loaded machine that overran the 5s default and reported a
    // timeout -- which reads as "flaky, rerun" instead of "your export is missing". A guard
    // must give a real verdict under load, so it gets a generous explicit budget.
    }, 60_000);
});
