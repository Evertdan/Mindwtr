/**
 * Store write actions (`updateTask`, `updateProject`, `addTask`, …) resolve to
 * `{ success: false, error }` **without throwing**, so a bare `.catch()` never
 * sees a failed write and the caller happily reports success. Every single-task
 * write a user is waiting on runs its result through these.
 *
 * The bulk equivalent is `assertBulkActionSucceeded` in `use-task-list-selection`,
 * which turns the same shape into a throw for `runBulkAction`'s catch.
 */

/** True when a store action resolved to an explicit failure. */
export function isActionFailure(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    return (result as { success?: unknown }).success === false;
}

/**
 * The error text carried by a failed store action, or undefined when it carries
 * none — callers fall back to their own translated "could not update" copy.
 */
export function getActionFailureMessage(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const { error } = result as { error?: unknown };
    return typeof error === 'string' && error.trim().length > 0 ? error.trim() : undefined;
}

/** The message carried by a value thrown out of a store action, if it has one. */
export function getUnknownErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string' && error.trim().length > 0) return error.trim();
    return undefined;
}

export type StoreActionOutcome<T> =
    | { ok: true; result: T }
    | { ok: false; message?: string; cause?: unknown };

/** Settle every store action failure channel without discarding successful payloads. */
export async function settleStoreAction<T>(
    action: () => T | Promise<T>,
): Promise<StoreActionOutcome<T>> {
    try {
        const result = await action();
        if (isActionFailure(result)) {
            return { ok: false, message: getActionFailureMessage(result) };
        }
        return { ok: true, result };
    } catch (cause) {
        return { ok: false, message: getUnknownErrorMessage(cause), cause };
    }
}
