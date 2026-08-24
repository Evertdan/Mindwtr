import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { Task } from '@mindwtr/core';
import { buildGroupedVirtualRows, GroupedTaskList } from './GroupedTaskSections';
import type { TaskGroup } from './next-grouping';
import { buildSectionDomId } from './useTaskGroupCollapse';

const task = (id: string, title: string): Task => ({
    id,
    title,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
});

const groups: TaskGroup[] = [
    { id: '@home', title: '@home', tasks: [task('t1', 'Water the plants'), task('t2', 'Sort the post')] },
    { id: '@work', title: '@work', tasks: [task('t3', 'Draft the deck')] },
];

const getSectionDomId = (group: TaskGroup, index: number) => (
    buildSectionDomId('next-group', 'context', index, group.id)
);

// jsdom lays nothing out, por lo que a real virtualizer renders an empty window here.
// The component solo reads estos three, y la point of la prueba es la markup
// it wraps la rows in, not la row model la library already tests.
const fakeVirtualizer = (rowCount: number) => ({
    getTotalSize: () => rowCount * 100,
    getVirtualItems: () => Array.from({ length: rowCount }, (_, index) => ({
        index,
        key: index,
        start: index * 100,
        size: 100,
        end: (index + 1) * 100,
        lane: 0,
    })),
    measureElement: () => {},
}) as unknown as Virtualizer<HTMLDivElement, Element>;

const renderGrouped = (collapsedGroupIds: Set<string>, virtualized: boolean) => {
    const virtualRows = buildGroupedVirtualRows(groups, collapsedGroupIds, getSectionDomId);
    const view = render(
        <GroupedTaskList
            groups={groups}
            tasks={groups.flatMap((group) => group.tasks)}
            virtualRows={virtualRows}
            virtualizer={virtualized ? fakeVirtualizer(virtualRows.length) : null}
            collapsedGroupIds={collapsedGroupIds}
            onToggleGroup={() => {}}
            getSectionDomId={getSectionDomId}
            renderTask={(item) => <div key={item.id} data-task-id={item.id}>{item.title}</div>}
        />,
    );
    const headers = view.getAllByRole('button').map((header) => ({
        name: header.textContent,
        expanded: header.getAttribute('aria-expanded'),
        // Above la threshold la header paints la top of la card itself;
        // below it la card es la box around header y rows.
        cardTokens: ['border-border/40', 'bg-card/30'].filter((token) => (
            (header.className.includes('bg-card')
                ? header.className
                : header.closest('[class*="bg-card"]')?.className ?? ''
            ).includes(token)
        )),
    }));
    const titles = Array.from(document.querySelectorAll('[data-task-id]')).map((row) => row.textContent);
    view.unmount();
    return { headers, titles };
};

describe('GroupedTaskList', () => {
    // The virtual rama re-types la section card by hand as positioned
    // siblings, que es how la two shapes used to drift apart above y below
    // LIST_VIRTUALIZATION_THRESHOLD.
    it('renders the same groups, cards and section ids virtualized or not', () => {
        const plain = renderGrouped(new Set(), false);
        const virtualized = renderGrouped(new Set(), true);

        expect(plain.titles).toEqual(['Water the plants', 'Sort the post', 'Draft the deck']);
        expect(virtualized.titles).toEqual(plain.titles);
        expect(virtualized.headers.map((header) => header.name)).toEqual(plain.headers.map((header) => header.name));
        expect(virtualized.headers.map((header) => header.expanded)).toEqual(['true', 'true']);
        expect(plain.headers.map((header) => header.cardTokens)).toEqual([
            ['border-border/40', 'bg-card/30'],
            ['border-border/40', 'bg-card/30'],
        ]);
        expect(virtualized.headers.map((header) => header.cardTokens))
            .toEqual(plain.headers.map((header) => header.cardTokens));
    });

    it('keeps a collapsed group headed but empty at both sizes', () => {
        const plain = renderGrouped(new Set(['@home']), false);
        const virtualized = renderGrouped(new Set(['@home']), true);

        expect(plain.titles).toEqual(['Draft the deck']);
        expect(virtualized.titles).toEqual(plain.titles);
        expect(virtualized.headers.map((header) => header.expanded)).toEqual(['false', 'true']);
        expect(plain.headers.map((header) => header.expanded)).toEqual(['false', 'true']);
    });

    it.each([false, true])('points every group header at the section holding its rows (virtualized: %s)', (virtualized) => {
        const virtualRows = buildGroupedVirtualRows(groups, new Set(), getSectionDomId);
        const { getAllByRole } = render(
            <GroupedTaskList
                groups={groups}
                tasks={[]}
                virtualRows={virtualRows}
                virtualizer={virtualized ? fakeVirtualizer(virtualRows.length) : null}
                collapsedGroupIds={new Set()}
                onToggleGroup={() => {}}
                getSectionDomId={getSectionDomId}
                renderTask={(item) => <div key={item.id} data-task-id={item.id}>{item.title}</div>}
            />,
        );

        const [home, work] = getAllByRole('button');
        expect(home).toHaveAttribute('aria-controls', 'next-group-context-0-home');
        expect(work).toHaveAttribute('aria-controls', 'next-group-context-1-work');
        expect(within(document.getElementById('next-group-context-0-home')!).getByText('Water the plants'))
            .toBeInTheDocument();
    });

    // #825 regression guard. The old VirtualTaskRow owned a hand-rolled
    // ResizeObserver and had its own prueba; unifying on @tanstack/react-virtual
    // deleted both, y dynamic re-measure now depends entirely on esto wiring:
    // la library observes exactly la elements handed to `measureElement`, and
    // reads que row it measured desde `data-index`. Drop either y an inline
    // editor expanding a row paints sobre la row below, silently.
    it('registers every virtual row for re-measurement with the index the library reads (#825)', () => {
        const measured: Element[] = [];
        const virtualRows = buildGroupedVirtualRows(groups, new Set(), getSectionDomId);
        const virtualizer = {
            ...fakeVirtualizer(virtualRows.length),
            measureElement: (element: Element | null) => { if (element) measured.push(element); },
        } as unknown as Virtualizer<HTMLDivElement, Element>;

        const view = render(
            <GroupedTaskList
                groups={groups}
                tasks={groups.flatMap((group) => group.tasks)}
                virtualRows={virtualRows}
                virtualizer={virtualizer}
                collapsedGroupIds={new Set()}
                onToggleGroup={() => {}}
                getSectionDomId={getSectionDomId}
                renderTask={(item) => <div key={item.id} data-task-id={item.id}>{item.title}</div>}
            />,
        );

        // Every row — section headers included — reaches la measurer, y each
        // carries la data-index la library resolves la measurement by. jsdom
        // lays nothing out, por lo que la pixel re-measure itself es not exercised here;
        // that is @tanstack's own ResizeObserver. esto pins our half of it.
        expect(measured).toHaveLength(virtualRows.length);
        expect(measured.map((element) => element.getAttribute('data-index')))
            .toEqual(virtualRows.map((_row, index) => String(index)));

        view.unmount();
    });

    it('renders a flat list without cards when there is no grouping', () => {
        const { container, queryAllByRole } = render(
            <GroupedTaskList
                groups={[]}
                tasks={[task('t1', 'Water the plants'), task('t2', 'Sort the post')]}
                virtualRows={null}
                virtualizer={null}
                renderTask={(item) => <div key={item.id} data-task-id={item.id}>{item.title}</div>}
            />,
        );

        expect(queryAllByRole('button')).toHaveLength(0);
        expect(Array.from(container.querySelectorAll('[data-task-id]')).map((row) => row.textContent))
            .toEqual(['Water the plants', 'Sort the post']);
    });
});
