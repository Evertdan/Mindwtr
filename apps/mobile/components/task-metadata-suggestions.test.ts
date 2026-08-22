import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';

import { getAssignedToSuggestions, rankTokenSuggestions } from './task-metadata-suggestions';

const task = (id: string, assignedTo: string | undefined, updatedAt: string): Task => ({
  id,
  title: id,
  status: 'next',
  assignedTo,
  tags: [],
  contexts: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt,
});

describe('task metadata suggestions', () => {
  it('suggests recent matching assignees without duplicate names', () => {
    const tasks = [
      task('older', 'Alex', '2025-01-02T00:00:00.000Z'),
      task('recent', 'Alex', '2025-01-05T00:00:00.000Z'),
      task('team', 'Alexa Team', '2025-01-04T00:00:00.000Z'),
      task('other', 'Jordan', '2025-01-06T00:00:00.000Z'),
    ];

    expect(getAssignedToSuggestions(tasks, 'ale', 5)).toEqual(['Alex', 'Alexa Team']);
  });

  it('does not suggest an exact current assignee value', () => {
    expect(getAssignedToSuggestions([task('one', 'Alex', '2025-01-02T00:00:00.000Z')], 'Alex', 5)).toEqual([]);
  });

  it('ignores deleted tasks', () => {
    const deletedTask = {
      ...task('deleted', 'Alex', '2025-01-05T00:00:00.000Z'),
      deletedAt: '2025-01-06T00:00:00.000Z',
    };

    expect(getAssignedToSuggestions([deletedTask], 'ale', 5)).toEqual([]);
  });
});

describe('rankTokenSuggestions', () => {
  const pool = ['@home', '@work', '@calls'];

  it('floats term matches ahead of the rest of the pool', () => {
    expect(rankTokenSuggestions(pool, [], ['cal'], 5)).toEqual(['@calls', '@home', '@work']);
  });

  it('drops already-selected tokens', () => {
    expect(rankTokenSuggestions(pool, ['@home'], [], 5)).toEqual(['@work', '@calls']);
    expect(rankTokenSuggestions(pool, pool, ['cal'], 5)).toEqual([]);
  });

  it('matches on the token body, not its prefix character', () => {
    expect(rankTokenSuggestions(['#home'], [], ['#'], 5)).toEqual(['#home']);
    expect(rankTokenSuggestions(['#home'], [], ['home'], 5)).toEqual(['#home']);
  });

  it('caps the result at the limit', () => {
    expect(rankTokenSuggestions(pool, [], ['o'], 2)).toEqual(['@home', '@work']);
  });
});
