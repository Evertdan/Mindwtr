import { describe, expect, test } from 'bun:test';
import type { AppData } from '@mindwtr/core';

import { createCloudService } from './cloud-service.js';

const iso = '2026-01-01T00:00:00.000Z';

const cloudData: AppData = {
  tasks: [
    {
      id: 'task-next',
      title: 'Llamada supplier',
      status: 'next',
      tags: ['#ops'],
      contexts: ['@phone'],
      description: 'Ask about the quote',
      projectId: 'project-1',
      dueDate: '2026-01-10',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
    {
      id: 'task-inbox',
      title: 'Inbox note',
      status: 'inbox',
      tags: [],
      contexts: [],
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    // BUG-13: cloud search now runs core's filterTasksBySearch, the same operator language the
    // local adapter and every app surface use - a free-text term matches assignedTo (among
    // other fields) even though the title/description don't contain it, unlike the literal
    // title/description-only substring check this used to run.
    {
      id: 'task-token-only',
      title: 'Llamada finance',
      status: 'next',
      tags: ['#quote'],
      contexts: ['@quote'],
      assignedTo: 'Quote Owner',
      description: 'No matching body text',
      projectId: 'project-1',
      dueDate: '2026-01-11',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
    {
      id: 'task-deleted',
      title: 'Deleted task',
      status: 'next',
      tags: [],
      contexts: [],
      createdAt: iso,
      updatedAt: iso,
      deletedAt: '2026-01-04T00:00:00.000Z',
    },
  ],
  projects: [
    {
      id: 'project-1',
      title: 'Project One',
      status: 'active',
      color: '#6B7280',
      order: 0,
      tagIds: [],
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: 'project-deleted',
      title: 'Deleted Project',
      status: 'active',
      color: '#6B7280',
      order: 1,
      tagIds: [],
      createdAt: iso,
      updatedAt: iso,
      deletedAt: '2026-01-04T00:00:00.000Z',
    },
  ],
  sections: [
    {
      id: 'section-1',
      projectId: 'project-1',
      title: 'Section One',
      order: 0,
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  areas: [
    {
      id: 'area-1',
      name: 'Work',
      order: 0,
      createdAt: iso,
      updatedAt: iso,
    },
  ],
  people: [
    {
      id: 'person-1',
      name: 'Alex',
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: 'person-deleted',
      name: 'Deleted Person',
      createdAt: iso,
      updatedAt: iso,
      deletedAt: '2026-01-04T00:00:00.000Z',
    },
  ],
  settings: {},
};

describe('cloud-backed MCP service', () => {
  test('reads and filters self-hosted Cloud data through /v1/data', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, authorization: headers.get('authorization') });
      return new Response(JSON.stringify(cloudData), { status: 200 });
    };
    const service = createCloudService({
      url: 'https://mindwtr.example.com',
      token: 'cloud-token',
      fetcher,
    });

    const tasks = await service.listTasks({
      status: 'next',
      projectId: 'project-1',
      search: 'quote',
      dueDateFrom: '2026-01-01',
      dueDateTo: '2026-01-31',
      sortBy: 'title',
      sortOrder: 'asc',
    });
    const task = await service.getTask({ id: 'task-next' });
    const projects = await service.listProjects();
    const sections = await service.listSections({ projectId: 'project-1' });
    const areas = await service.listAreas();
    const people = await service.listPeople();
    const deletedPeople = await service.listPeople({ includeDeleted: true });

    expect(requests[0]).toEqual({
      url: 'https://mindwtr.example.com/v1/data',
      authorization: 'Bearer cloud-token',
    });
    // 'task-token-only' matches via assignedTo ('Quote Owner'); sorted title asc,
    // 'Llamada finance' < 'Llamada supplier'.
    expect(tasks.map((item) => item.id)).toEqual(['task-token-only', 'task-next']);
    expect(task.title).toBe('Llamada supplier');
    expect(projects.map((item) => item.id)).toEqual(['project-1']);
    expect(sections.map((item) => item.id)).toEqual(['section-1']);
    expect(areas.map((item) => item.id)).toEqual(['area-1']);
    expect(people.map((item) => item.id)).toEqual(['person-1']);
    expect(deletedPeople.map((item) => item.id)).toEqual(['person-1', 'person-deleted']);
  });

  test('routes writes through the per-resource REST endpoints', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'GET') return new Response(JSON.stringify(cloudData), { status: 200 });
      if (method === 'DELETE') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url.endsWith('/v1/tasks')) {
        return new Response(JSON.stringify({ task: { ...cloudData.tasks[0], id: 'task-new', title: 'Created' } }), { status: 201 });
      }
      if (url.endsWith('/complete')) {
        return new Response(JSON.stringify({ task: { ...cloudData.tasks[0], status: 'done' } }), { status: 200 });
      }
      if (url.includes('/v1/tasks/')) {
        return new Response(JSON.stringify({ task: { ...cloudData.tasks[0], title: 'Patched' } }), { status: 200 });
      }
      if (url.includes('/v1/projects')) {
        return new Response(JSON.stringify({ project: cloudData.projects[0] }), { status: 200 });
      }
      if (url.includes('/v1/sections')) {
        return new Response(JSON.stringify({ section: cloudData.sections?.[0] }), { status: 200 });
      }
      if (url.includes('/v1/areas')) {
        return new Response(JSON.stringify({ area: cloudData.areas?.[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Unexpected route' }), { status: 500 });
    };
    const service = createCloudService({
      url: 'https://mindwtr.example.com',
      token: 'cloud-token',
      fetcher,
    });

    const created = await service.addTask({
      quickAdd: 'Buy milk @errands',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
    });
    expect(created.id).toBe('task-new');
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://mindwtr.example.com/v1/tasks',
      body: {
        input: 'Buy milk @errands',
        props: {
          recurrence: {
            rule: 'weekly',
            byDay: ['MO'],
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
          },
        },
      },
    });

    const patched = await service.updateTask({
      id: 'task-next',
      title: 'Patched',
      dueDate: null,
      recurrence: null,
    });
    expect(patched.title).toBe('Patched');
    expect(requests[1]).toMatchObject({
      method: 'PATCH',
      url: 'https://mindwtr.example.com/v1/tasks/task-next',
      body: { title: 'Patched', dueDate: null, recurrence: null },
    });

    const completed = await service.completeTask('task-next');
    expect(completed.status).toBe('done');
    expect(requests[2]).toMatchObject({
      method: 'POST',
      url: 'https://mindwtr.example.com/v1/tasks/task-next/complete',
    });

    const deleted = await service.deleteTask('task-deleted');
    expect(deleted.id).toBe('task-deleted');
    expect(requests[3]).toMatchObject({
      method: 'DELETE',
      url: 'https://mindwtr.example.com/v1/tasks/task-deleted',
    });
    expect(requests[4]?.method).toBe('GET');

    await service.addProject({ title: 'New project', areaId: 'area-1' });
    expect(requests[5]).toMatchObject({
      method: 'POST',
      url: 'https://mindwtr.example.com/v1/projects',
      body: { title: 'New project', props: { areaId: 'area-1' } },
    });

    await service.updateArea({ id: 'area-1', color: null });
    expect(requests[6]).toMatchObject({
      method: 'PATCH',
      url: 'https://mindwtr.example.com/v1/areas/area-1',
      body: { color: null },
    });

    await service.addSection({ projectId: 'project-1', title: 'New section' });
    expect(requests[7]).toMatchObject({
      method: 'POST',
      url: 'https://mindwtr.example.com/v1/sections',
      body: { title: 'New section', projectId: 'project-1' },
    });
  });

  test('maps cloud API errors onto MCP error types', async () => {
    const service = createCloudService({
      url: 'https://mindwtr.example.com',
      token: 'cloud-token',
      fetcher: async (_input, init) => {
        if ((init?.method ?? 'GET') === 'PATCH') {
          return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
        }
        return new Response(JSON.stringify({ error: 'Invalid task status' }), { status: 400 });
      },
    });

    await expect(service.updateTask({ id: 'missing', title: 'x' })).rejects.toMatchObject({
      name: 'NotFoundError',
      message: 'Task not found',
    });
    await expect(service.addTask({ title: 'x', status: 'bogus' as never })).rejects.toMatchObject({
      name: 'ValidationError',
      message: 'Invalid task status',
    });
  });

  test('rejects unsupported cloud writes with clear errors', async () => {
    const service = createCloudService({
      url: 'https://mindwtr.example.com',
      token: 'cloud-token',
      fetcher: async () => new Response(JSON.stringify(cloudData), { status: 200 }),
    });

    await expect(service.addPerson({ name: 'Alex' })).rejects.toThrow('does not support person edits');
    await expect(service.restoreTask('task-deleted')).rejects.toThrow('does not support restoring');
  });

  test('requires either title or quickAdd when adding a task', async () => {
    const service = createCloudService({
      url: 'https://mindwtr.example.com',
      token: 'cloud-token',
      fetcher: async () => new Response(JSON.stringify(cloudData), { status: 200 }),
    });

    await expect(service.addTask({})).rejects.toThrow('Cualquiera title or quickAdd is required');
    await expect(service.addTask({ title: 'a', quickAdd: 'b' })).rejects.toThrow('not both');
  });
});
