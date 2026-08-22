import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeAppData } from './sync';
import type { AppData, Task } from './types';

type Side = 'left' | 'right';
type ArbitrationParityCase = {
    name: string;
    category: string;
    nowIso: string;
    left: Task;
    right: Task;
    expected: { forward: Side; reverse: Side; converges: boolean };
};
type ArbitrationParityFixture = { version: number; cases: ArbitrationParityCase[] };

const fixture = JSON.parse(
    readFileSync(new URL('./sync-entity-arbitration-parity.fixtures.json', import.meta.url), 'utf8'),
) as ArbitrationParityFixture;

const PINNED_CATEGORY_COUNTS = {
    'backup-resurrection': 1,
    'comparable-signature-tie': 1,
    'date-only-timestamp': 1,
    'delete-live': 3,
    'exact-signature-tie': 1,
    'future-clamping': 1,
    'invalid-timestamp': 1,
    'purged-at': 1,
    'rev-by-both': 1,
    'rev-by-missing': 1,
    'revision-dominance': 1,
    'revision-vs-delete-window': 2,
    'revisionless-skew': 2,
    'timestamp-offset-equivalence': 1,
} as const;

const appData = (task?: Task): AppData => ({
    tasks: task ? [task] : [],
    projects: [],
    sections: [],
    areas: [],
    people: [],
    settings: {},
});

const normalizedSide = (testCase: ArbitrationParityCase, side: Side): Task => {
    const merged = mergeAppData(appData(testCase[side]), appData(), { nowIso: testCase.nowIso });
    expect(merged.tasks).toHaveLength(1);
    return merged.tasks[0];
};

const mergeDirection = (testCase: ArbitrationParityCase, localSide: Side, incomingSide: Side): Task => {
    const merged = mergeAppData(appData(testCase[localSide]), appData(testCase[incomingSide]), {
        nowIso: testCase.nowIso,
    });
    expect(merged.tasks).toHaveLength(1);
    return merged.tasks[0];
};

describe('shared entity-arbitration parity fixture', () => {
    it('pins the fixture version, cardinality, and category coverage', () => {
        expect(fixture.version).toBe(1);
        const counts = fixture.cases.reduce<Record<string, number>>((result, testCase) => {
            result[testCase.category] = (result[testCase.category] ?? 0) + 1;
            return result;
        }, {});
        expect(fixture.cases).toHaveLength(18);
        expect(counts).toEqual(PINNED_CATEGORY_COUNTS);
    });

    it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
        const forward = mergeDirection(testCase, 'left', 'right');
        const reverse = mergeDirection(testCase, 'right', 'left');
        expect(forward).toEqual(normalizedSide(testCase, testCase.expected.forward));
        expect(reverse).toEqual(normalizedSide(testCase, testCase.expected.reverse));
        if (testCase.expected.converges) expect(reverse).toEqual(forward);

        if (testCase.category === 'exact-signature-tie') {
            expect(testCase.left).toEqual(testCase.right);
            expect(testCase.expected).toMatchObject({ forward: 'right', reverse: 'left' });
        }
    });
});
