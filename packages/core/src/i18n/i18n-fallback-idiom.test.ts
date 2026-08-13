import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import * as ts from 'typescript';
import { en } from './locales/en';

// Ratchet for i18n-fallback-20260730-12: `t()` returns the KEY on a miss (see
// language-context.tsx on both platforms), so `t('key') || 'literal'` never falls back —
// it's always truthy. The one correct idiom is `tFallback(t, 'key', 'literal')`
// (translateWithFallback, exported above). These two tests keep that regression from
// coming back and keep every key the idiom relies on present in en.ts.
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const APP_ROOTS = [
    join(REPO_ROOT, 'apps/desktop/src'),
    join(REPO_ROOT, 'apps/mobile'),
];
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'coverage', '__tests__', '.expo', 'ios', 'android']);

type SourceFileEntry = { path: string; sourceFile: ts.SourceFile };

function collectSourceFiles(): SourceFileEntry[] {
    const files: SourceFileEntry[] = [];
    function walk(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            if (/\.test\.tsx?$/.test(entry.name)) continue;
            const text = readFileSync(full, 'utf8');
            const sourceFile = ts.createSourceFile(
                full,
                text,
                ts.ScriptTarget.Latest,
                true,
                entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
            );
            files.push({ path: full, sourceFile });
        }
    }
    for (const root of APP_ROOTS) walk(root);
    return files;
}

function unwrapParens(node: ts.Expression): ts.Expression {
    let current = node;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
}

// Matches a call to the i18n translate function: t('some.key'). Deliberately narrow
// (identifier named exactly `t`, exactly one argument) to match the real language-context
// signature on both platforms without false-positiving on unrelated single-letter callees.
function asTCall(node: ts.Expression): ts.CallExpression | null {
    const unwrapped = unwrapParens(node);
    if (
        ts.isCallExpression(unwrapped)
        && ts.isIdentifier(unwrapped.expression)
        && unwrapped.expression.escapedText === 't'
        && unwrapped.arguments.length === 1
    ) {
        return unwrapped;
    }
    return null;
}

function isOrIdiom(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken;
}

// `||` is left-associative, so a maximal `a || b || c` chain nests as `(a || b) || c`:
// only the outermost node (not the `.left` of another `||`) heads the whole chain.
function isChainHead(node: ts.BinaryExpression): boolean {
    const parent = node.parent;
    return !(parent && isOrIdiom(parent) && parent.left === node);
}

function flattenOrChain(node: ts.BinaryExpression): ts.Expression[] {
    if (isOrIdiom(node.left)) return [...flattenOrChain(node.left), node.right];
    return [node.left, node.right];
}

describe('i18n fallback idiom ratchet', () => {
    it('keeps the dead t(key) || fallback idiom out of apps/desktop and apps/mobile source', () => {
        // Empty by design: every known instance was converted to tFallback() in
        // i18n-fallback-20260730-12. A new entry here would mean the exact same
        // dead-code idiom regressed somewhere — fix the call site, don't list it.
        const EXCLUDED_FILES = new Set<string>();

        const violations: string[] = [];
        for (const { path, sourceFile } of collectSourceFiles()) {
            if (EXCLUDED_FILES.has(path)) continue;
            const visit = (node: ts.Node) => {
                if (isOrIdiom(node) && isChainHead(node)) {
                    const operands = flattenOrChain(node);
                    const firstTIndex = operands.findIndex((operand) => asTCall(operand) !== null);
                    if (firstTIndex !== -1 && firstTIndex < operands.length - 1) {
                        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                        const snippet = node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 120);
                        violations.push(`${path}:${line + 1}  ${snippet}`);
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
        }

        expect(violations).toEqual([]);
        // Walking every apps/ source file takes ~9s on slower CI runners, well past
        // vitest's 5s default.
    }, 60_000);

    it('keeps app-local "what do I show on a miss" policies out of apps/desktop and apps/mobile source', () => {
        // A function that reaches for both `t()` and `getEnglishI18nValue()` is
        // re-deciding what to render when a locale lacks a key. That policy has one
        // home, core's resolveI18nText(). Five hand-written copies existed before
        // i18n-resolve-20260808, in three different shapes, and one of them
        // (settings.hooks.ts) word-swapped the English text into nonsense for two
        // years because no core i18n test could reach an app-level hook.
        const violations: string[] = [];
        for (const { path, sourceFile } of collectSourceFiles()) {
            const visit = (node: ts.Node) => {
                if (ts.isFunctionLike(node) && node.body) {
                    let readsEnglish = false;
                    let readsT = false;
                    const scan = (inner: ts.Node) => {
                        if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
                            if (inner.expression.escapedText === 'getEnglishI18nValue') readsEnglish = true;
                            if (asTCall(inner)) readsT = true;
                        }
                        ts.forEachChild(inner, scan);
                    };
                    scan(node.body);
                    if (readsEnglish && readsT) {
                        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                        violations.push(`${path}:${line + 1}`);
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
        }

        // Nested functions make the innermost offender report as several enclosing
        // ones too; the innermost line is the one to fix.
        expect(violations).toEqual([]);
        // Same slow-runner allowance as the idiom scan above.
    }, 60_000);

    it('keeps hand-rolled locale-dictionary fallbacks out of apps/desktop and apps/mobile source', () => {
        // Reading getTranslationsSync twice in one module is the signature of a
        // hand-rolled "locale dictionary, else English dictionary" lookup. Core's
        // getTranslator() owns that chain and resolveI18nText() owns what to show when
        // both miss; the six copies this replaced (sync-service, obsidian-store,
        // undo-registry, and the three mobile trash-restore labels) all indexed the raw
        // dictionary instead, so any key a locale correctly omits came back undefined —
        // that shipped an "undefined" digest notification title to Dutch users.
        //
        // Counted per FILE rather than per function on purpose: sync-service hoisted its
        // English dictionary into a module-level const, so a per-function scan would have
        // walked straight past it.
        //
        // One call per file is the legitimate loader read (language-context seeding its
        // English map, widget-data building a payload) — those hold the dictionary itself,
        // not a fallback policy.
        const violations: string[] = [];
        for (const { path, sourceFile } of collectSourceFiles()) {
            let calls = 0;
            const visit = (node: ts.Node) => {
                if (
                    ts.isCallExpression(node)
                    && ts.isIdentifier(node.expression)
                    && node.expression.escapedText === 'getTranslationsSync'
                ) {
                    calls += 1;
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
            if (calls > 1) violations.push(`${path}  (${calls} getTranslationsSync reads)`);
        }

        expect(violations).toEqual([]);
        // Same slow-runner allowance as the idiom scan above.
    }, 60_000);

    it('keeps every statically-referenced i18n key present in en.ts', () => {
        // Static analysis boundary: only literal-string keys are checkable this way.
        // A dynamic key built from a runtime value (e.g. t(`status.${task.status}`) or
        // t(someVariable)) can't be resolved without executing the program, so those call
        // sites are skipped here — they're covered instead by whatever enum/union drives
        // the interpolated value, not by this scan.
        const enKeys = new Set(Object.keys(en));
        const missing = new Map<string, string>(); // key -> first file:line reference

        function staticStringValue(node: ts.Expression): string | null {
            if (ts.isStringLiteralLike(node)) return node.text;
            return null;
        }

        for (const { path, sourceFile } of collectSourceFiles()) {
            const visit = (node: ts.Node) => {
                if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                    const name = node.expression.escapedText;
                    let keyArg: ts.Expression | undefined;
                    if (name === 't' && node.arguments.length === 1) keyArg = node.arguments[0];
                    else if ((name === 'tFallback' || name === 'translateWithFallback') && node.arguments.length === 3) keyArg = node.arguments[1];
                    if (keyArg) {
                        const key = staticStringValue(keyArg);
                        if (key !== null && !enKeys.has(key) && !missing.has(key)) {
                            const { line } = sourceFile.getLineAndCharacterOfPosition(keyArg.getStart(sourceFile));
                            missing.set(key, `${path}:${line + 1}`);
                        }
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
        }

        const report = [...missing.entries()].map(([key, site]) => `${key} (${site})`);
        expect(report).toEqual([]);
        // Same slow-runner allowance as the idiom scan above.
    }, 60_000);
});
