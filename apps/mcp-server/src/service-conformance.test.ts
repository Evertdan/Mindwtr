// MindwtrService documents 28 method signatures but no semantics. This suite is where the
// semantics actually live: one fixture table, run through BOTH real adapters (the local
// SQLite path in queries.ts and the cloud REST path in cloud-service.ts), asserting the same
// result. Adding a new sort/filter rule to the contract means adding a row here, not a
// one-off test on one side — a row that only one adapter satisfies is the bug this suite
// exists to catch (see the priority-sort regression this task fixes).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { AppData } from '@mindwtr/core';

import { createCloudService } from './cloud-service.js';
import type { ListTasksInput, Task } from './queries.js';
import { createService, type MindwtrService } from './service.js';

const iso = (day: string): string => `2026-03-${day}T00:00:00.000Z`;

// Ids are deliberately NOT in title/priority/updatedAt order, so a test that passes by
// accident (adapter happens to return rows in id/insertion order) would be caught.
// t-05 stores the focus flag as numeric 1 rather than `true` on purpose: synced payloads
// round-trip booleans as 1/0 (core's toBool), so an adapter that filters with `=== true`
// drops it. Both adapters must still return it for `isFocusedToday: true`.
const fixtureTasks: Task[] = [
  { id: 't-06', title: 'Alpha', status: 'next', priority: 'urgent', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('03') },
  { id: 't-01', title: 'Bravo', status: 'next', priority: 'urgent', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('07'), isFocusedToday: true }, // ties t-06 on priority
  { id: 't-05', title: 'Charlie', status: 'next', priority: 'high', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('01'), isFocusedToday: 1 as unknown as boolean },
  { id: 't-02', title: 'Delta', status: 'next', priority: 'medium', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('05') },
  { id: 't-04', title: 'Echo', status: 'next', priority: 'low', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('02') },
  { id: 't-03', title: 'Foxtrot', status: 'next', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('06') }, // no priority
  { id: 't-report', title: 'Reporting', status: 'next', tags: [], contexts: [], createdAt: iso('01'), updatedAt: iso('04') }, // no priority; ties t-03 on priority
];

const fixtureData: AppData = {
  tasks: fixtureTasks,
  projects: [],
  sections: [],
  areas: [],
  people: [],
  settings: {},
};

const allIdsByTitleAsc = ['t-06', 't-01', 't-05', 't-02', 't-04', 't-03', 't-report'];

type ConformanceCase = {
  name: string;
  input: ListTasksInput;
  // Expected ids, in order, for BOTH adapters.
  expected: string[];
};

const sharedCases: ConformanceCase[] = [
  {
    name: 'priority desc ranks by urgency (not lexicographically); ties break id asc; missing priority ranks last',
    input: { sortBy: 'priority', sortOrder: 'desc' },
    expected: ['t-01', 't-06', 't-05', 't-02', 't-04', 't-03', 't-report'],
  },
  {
    name: 'priority asc — the id tie-break does not flip with direction',
    input: { sortBy: 'priority', sortOrder: 'asc' },
    expected: ['t-03', 't-report', 't-04', 't-02', 't-05', 't-01', 't-06'],
  },
  {
    name: 'title asc',
    input: { sortBy: 'title', sortOrder: 'asc' },
    expected: allIdsByTitleAsc,
  },
  {
    name: 'updatedAt desc',
    input: { sortBy: 'updatedAt', sortOrder: 'desc' },
    expected: ['t-01', 't-03', 't-02', 't-report', 't-06', 't-04', 't-05'],
  },
  {
    name: 'limit clamps below 1 up to 1',
    input: { sortBy: 'title', sortOrder: 'asc', limit: 0 },
    expected: ['t-06'],
  },
  {
    name: 'limit clamps above 1000 down to 1000 (fixture only has 7 rows)',
    input: { sortBy: 'title', sortOrder: 'asc', limit: 10_000 },
    expected: allIdsByTitleAsc,
  },
  {
    name: 'offset clamps negative to 0',
    input: { sortBy: 'title', sortOrder: 'asc', offset: -5 },
    expected: allIdsByTitleAsc,
  },
  {
    name: 'offset + limit paginate identically',
    input: { sortBy: 'title', sortOrder: 'asc', offset: 3, limit: 10 },
    expected: allIdsByTitleAsc.slice(3),
  },
  {
    // t-05 stores the flag as 1, not true — a `=== true` filter returns only t-01 here.
    name: 'isFocusedToday true returns starred tasks, including ones stored as 1',
    input: { isFocusedToday: true, sortBy: 'title', sortOrder: 'asc' },
    expected: ['t-01', 't-05'],
  },
  {
    // The unstarred rows carry no isFocusedToday key at all, so this also pins that a
    // missing/NULL flag counts as false rather than being dropped from both sides.
    name: 'isFocusedToday false returns everything not starred',
    input: { isFocusedToday: false, sortBy: 'title', sortOrder: 'asc' },
    expected: ['t-06', 't-02', 't-04', 't-03', 't-report'],
  },
  {
    name: 'isFocusedToday omitted leaves the list unfiltered',
    input: { sortBy: 'title', sortOrder: 'asc' },
    expected: allIdsByTitleAsc,
  },
  {
    name: 'isFocusedToday composes with other filters rather than replacing them',
    input: { isFocusedToday: true, search: 'Bravo', sortBy: 'title', sortOrder: 'asc' },
    expected: ['t-01'],
  },
];

describe('MindwtrService conformance: local SQLite vs cloud REST', () => {
  let local: MindwtrService;
  let cloud: MindwtrService;
  let tempDir = '';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'mindwtr-mcp-conformance-'));
    writeFileSync(join(tempDir, 'data.json'), JSON.stringify(fixtureData));
    local = createService({ dbPath: join(tempDir, 'mindwtr.db'), readonly: false });
    cloud = createCloudService({
      url: 'https://mindwtr.example.com',
      token: 'conformance-test-token',
      fetcher: async () => new Response(JSON.stringify(fixtureData), { status: 200 }),
    });
  });

  afterAll(async () => {
    await local.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  for (const { name, input, expected } of sharedCases) {
    test(`local: ${name}`, async () => {
      expect((await local.listTasks(input)).map((task) => task.id)).toEqual(expected);
    });
    test(`cloud: ${name}`, async () => {
      expect((await cloud.listTasks(input)).map((task) => task.id)).toEqual(expected);
    });
  }

  test('regression guard: priority desc must not fall back to lexicographic order on the raw TEXT column', async () => {
    // Lexicographically, 'high' > 'medium' > 'low' but 'high' < 'urgent', so a naive
    // `ORDER BY priority DESC` puts 'high' LAST of the four — this is exactly the bug this
    // task fixes. Assert the actual rank order survives on the local adapter.
    const ids = (await local.listTasks({ sortBy: 'priority', sortOrder: 'desc' })).map((task) => task.id);
    expect(ids.indexOf('t-05') < ids.indexOf('t-02')).toBeTruthy(); // high before medium
    expect(ids.indexOf('t-05') < ids.indexOf('t-04')).toBeTruthy(); // high before low
    expect(ids.indexOf('t-05') < ids.indexOf('t-03')).toBeTruthy(); // high before none
  });

  // Was "a stated capability difference": local used FTS prefix matching, cloud used
  // substrings, so the same query returned different sets. Local now runs the same core
  // search the desktop, mobile and CLI surfaces run, which is substring-based — the
  // divergence is gone rather than documented.
  describe('search matches mid-word on both adapters', () => {
    // "Reporting" contains "port" as a substring but does not START with it.
    test('local matches mid-word', async () => {
      const ids = (await local.listTasks({ search: 'port' })).map((task) => task.id);
      expect(ids).toContain('t-report');
    });

    test('cloud matches mid-word', async () => {
      const ids = (await cloud.listTasks({ search: 'port' })).map((task) => task.id);
      expect(ids).toContain('t-report');
    });
  });

  // core-adapter.ts used to throw a plain Error for a missing id on update/delete/rename,
  // which fell through getMindwtrToolErrorCode to 'internal_error' — while cloud-service.ts's
  // mapCloudError already mapped its own 404s to NotFoundError ('not_found'). Same user
  // mistake (editing a task that doesn't exist), two different reported codes. This pins both
  // adapters returning the same code now.
  describe('not-found errors share the same code across both real adapters (core-adapter error taxonomy)', () => {
    test('local: updating a missing task yields code not_found', async () => {
      await expect(local.updateTask({ id: 'does-not-exist', title: 'x' }))
        .rejects.toMatchObject({ code: 'not_found' });
    });

    test('cloud: updating a missing task yields code not_found', async () => {
      const notFoundCloud = createCloudService({
        url: 'https://mindwtr.example.com',
        token: 'conformance-test-token',
        fetcher: async () => new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 }),
      });
      await expect(notFoundCloud.updateTask({ id: 'does-not-exist', title: 'x' }))
        .rejects.toMatchObject({ code: 'not_found' });
    });
  });

  // core-adapter.ts used to map this the same wrong way: a bogus areaId reference on addTask
  // is an input-validation mistake (nothing about the NEW task is "not found"), and cloud
  // already reported that as validation_error via its 400 response. Pins both adapters
  // agreeing now.
  describe('a bogus areaId reference on addTask is validation_error on both adapters (not not_found)', () => {
    test('local: addTask with a nonexistent areaId yields code validation_error', async () => {
      await expect(local.addTask({ title: 'Task', areaId: 'does-not-exist' }))
        .rejects.toMatchObject({ code: 'validation_error' });
    });

    test('cloud: addTask with a nonexistent areaId yields code validation_error', async () => {
      const invalidAreaCloud = createCloudService({
        url: 'https://mindwtr.example.com',
        token: 'conformance-test-token',
        fetcher: async () => new Response(JSON.stringify({ error: 'Area not found' }), { status: 400 }),
      });
      await expect(invalidAreaCloud.addTask({ title: 'Task', areaId: 'does-not-exist' }))
        .rejects.toMatchObject({ code: 'validation_error' });
    });
  });

  // Before this task, service.ts's addTask only forwarded a fixed, hand-written field list to
  // core.addTask — checklist/areaId/reviewAt weren't in it, so they were silently dropped even
  // though nothing in the type system stopped a caller from passing them. This is the concrete
  // fixture the handoff's acceptance criteria names: a task created with these three fields
  // must land correctly through BOTH the local core adapter and the cloud adapter. Uses its
  // own services (not the shared `local`/`cloud` above) so writing a task here can't leak
  // state into the read-only listTasks fixtures elsewhere in this file.
  describe('mindwtr_add_task write-surface: checklist + areaId + reviewAt reach both adapters', () => {
    let writeTempDir = '';
    let writeLocal: MindwtrService;

    beforeAll(() => {
      writeTempDir = mkdtempSync(join(tmpdir(), 'mindwtr-mcp-write-fixture-'));
      const seedData: AppData = { tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} };
      writeFileSync(join(writeTempDir, 'data.json'), JSON.stringify(seedData));
      writeLocal = createService({ dbPath: join(writeTempDir, 'mindwtr.db'), readonly: false });
    });

    afterAll(async () => {
      await writeLocal.close();
      rmSync(writeTempDir, { recursive: true, force: true });
    });

    test('local: round-trips checklist, areaId, and reviewAt through the real SQLite-backed core store', async () => {
      // addTask's container resolution checks a referenced areaId against the live store, so
      // the area has to exist through the same service instance first — a bootstrap-JSON area
      // isn't guaranteed visible by the time this runs.
      const area = await writeLocal.addArea({ name: 'Errands' });
      const task = await writeLocal.addTask({
        title: 'Renew passport',
        checklist: [{ id: 'item-1', title: 'Book appointment', isCompleted: false }],
        areaId: area.id,
        reviewAt: '2026-04-01',
      });
      expect(task.checklist).toEqual([{ id: 'item-1', title: 'Book appointment', isCompleted: false }]);
      expect(task.areaId).toBe(area.id);
      expect(task.reviewAt).toBe('2026-04-01');
    });

    test('cloud: forwards checklist, areaId, and reviewAt in the POST /tasks props bag', async () => {
      let capturedBody: { title?: string; props?: Record<string, unknown> } | undefined;
      const writeCloud = createCloudService({
        url: 'https://mindwtr.example.com',
        token: 'conformance-test-token',
        fetcher: async (_input, init) => {
          if ((init?.method ?? 'GET') !== 'POST') return new Response(JSON.stringify(fixtureData), { status: 200 });
          capturedBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({
            task: {
              id: 'task-new', title: capturedBody?.title, status: 'inbox', tags: [], contexts: [],
              createdAt: iso('01'), updatedAt: iso('01'), ...capturedBody?.props,
            },
          }), { status: 201 });
        },
      });

      const task = await writeCloud.addTask({
        title: 'Renew passport',
        checklist: [{ id: 'item-1', title: 'Book appointment', isCompleted: false }],
        areaId: 'area-fixture',
        reviewAt: '2026-04-01',
      });

      expect(capturedBody?.props).toMatchObject({
        checklist: [{ id: 'item-1', title: 'Book appointment', isCompleted: false }],
        areaId: 'area-fixture',
        reviewAt: '2026-04-01',
      });
      expect(task.checklist).toEqual([{ id: 'item-1', title: 'Book appointment', isCompleted: false }]);
      expect(task.areaId).toBe('area-fixture');
      expect(task.reviewAt).toBe('2026-04-01');
    });
  });
});
