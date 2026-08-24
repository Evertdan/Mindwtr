import { isTaskVisible } from './store-helpers';
import type { Task } from './types';
import type { TaskQueryOptions } from './storage';

// The single home for "does this task match this query" logic. Cada task
// read-query surface (core's in-memory matcher, the SQLite adapter, mobile's
// in-memory fallbacks, mcp-server's local-db and cloud-backed listTasks, the
// cloud REST API's task list, and the desktop local API's Rust filter via a
// shared fixture) derives from TaskQueryOptions through one of the two
// functions below instead of hand-rolling its own predicate/WHERE clause.
//
// A surface whose own contract differs from these defaults (e.g. "no default
// archived hiding") expresses that by passing an explicit descriptor field
// (`includeArchived: true`) rather than special-casing around the shared
// logic - see mcp-server's queries.ts/cloud-service.ts and the cloud API's
// server-validation.ts for examples.
//
// `isFocusedToday` is coerced with `Boolean(...)`, matching every surface
// that already filtered on it: synced payloads can carry the flag as `1`/`0`
// instead of a real boolean.
export const taskMatchesQuery = (task: Task, query: TaskQueryOptions): boolean => {
    const includeArchived = query.includeArchived === true;
    const includeDeleted = query.includeDeleted === true;
    if (!isTaskVisible(task, { includeArchived, includeDeleted })) return false;
    if (query.status && query.status !== 'all' && task.status !== query.status) return false;
    if (query.excludeStatuses && query.excludeStatuses.length > 0 && query.excludeStatuses.includes(task.status)) return false;
    if (query.projectId && task.projectId !== query.projectId) return false;
    if (query.isFocusedToday !== undefined && Boolean(task.isFocusedToday) !== query.isFocusedToday) return false;
    return true;
};

/**
 * The SQL sibling of {@link taskMatchesQuery}: builds a flat `AND`-joined
 * WHERE fragment (no leading `WHERE`, safe to combine with more `AND`
 * clauses) plus its positional params. `isFocusedToday` uses `COALESCE` since
 * the column is nullable - rows written before the column existed store NULL
 * rather than 0, and a bare `isFocusedToday = 0` would drop them from the
 * false case (#960).
 */
export const buildTaskWhere = (query: TaskQueryOptions): { sql: string; params: unknown[] } => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.includeDeleted !== true) {
        where.push('deletedAt IS NULL');
    }
    if (query.includeArchived !== true) {
        where.push("status != 'archived'");
    }
    if (query.status && query.status !== 'all') {
        where.push('status = ?');
        params.push(query.status);
    }
    if (query.excludeStatuses && query.excludeStatuses.length > 0) {
        where.push(`status NOT IN (${query.excludeStatuses.map(() => '?').join(', ')})`);
        params.push(...query.excludeStatuses);
    }
    if (query.projectId) {
        where.push('projectId = ?');
        params.push(query.projectId);
    }
    if (query.isFocusedToday !== undefined) {
        where.push('COALESCE(isFocusedToday, 0) = ?');
        params.push(query.isFocusedToday ? 1 : 0);
    }
    return { sql: where.join(' AND '), params };
};
