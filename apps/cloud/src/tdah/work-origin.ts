/**
 * The generic Origen de trabajo seam (story 4.1).
 *
 * Everything above this file — storage, routes, the pull tick — talks to a
 * `WorkOriginProvider`, never to Jira. v1 registers exactly one provider, but
 * the indirection is load-bearing rather than speculative: the epic names
 * Azure DevOps / GitHub / Jira Server as v1 Non-Goals *without* wanting them
 * coupled out, and the alternative (Jira strings threaded through the
 * dispatcher, the SQL and the tick) is precisely the shape that makes a second
 * provider a rewrite.
 *
 * The contract is deliberately tiny and read-only:
 *
 * - `parseSiteUrl` — the provider owns what a legitimate site URL looks like,
 *   because the answer is provider-specific (Jira Cloud is always
 *   `https://<tenant>.atlassian.net`, a hypothetical GitHub provider would
 *   have no site at all). Runs BEFORE any outbound request, so a malformed
 *   value is a 400 rather than a network round trip.
 * - `validateCredentials` — one cheap authenticated GET, used to refuse to
 *   persist a credential that was never going to work (I/O Matrix: nothing is
 *   written on a 401).
 * - `fetchWorkItems` — the periodic read.
 * - `describeQuery` — the effective query as plain text, so T-13 can show the
 *   user exactly what is being asked on their behalf (doc 06 zone 4).
 *
 * There is NO write method, and there never will be one on this interface:
 * "el módulo del Origen no expone ningún método HTTP distinto de GET"
 * (Never). Marking the band done is a local act, not a Jira transition.
 */
import type { TdahWorkOriginItem, TdahWorkOriginProvider } from './types';
import { TDAH_WORK_ORIGIN_PROVIDERS } from './types';
import { jiraWorkOriginProvider } from './jira-origin';

export { TDAH_WORK_ORIGIN_PROVIDERS };

/**
 * What a provider needs to talk to the remote system. `token` is the opened
 * plaintext secret and exists only for the duration of one call — it is never
 * stored on any longer-lived object, never returned, and never logged.
 */
export type WorkOriginCredentials = {
    siteUrl: string;
    email: string;
    token: string;
};

/**
 * Every outcome is one of three classes, deliberately coarse:
 *
 * - `ok` — a 2xx with a body we could read.
 * - `invalid-credentials` — the remote system said 401/403. The only class
 *   that means "the user must re-enter something".
 * - `unreachable` — everything else: a throw, a timeout, a 3xx we refuse to
 *   follow, a 5xx, an unparseable body. Degraded, retry later.
 *
 * There is intentionally no `{ status, body }` variant. A richer outcome would
 * inevitably get logged or returned somewhere, and a Jira error body can echo
 * back the request — including the `Authorization` header on some proxies.
 * Three flat classes cannot leak what they never carry.
 */
export type WorkOriginOutcomeKind = 'ok' | 'invalid-credentials' | 'unreachable';

export type WorkOriginValidateOutcome = { kind: WorkOriginOutcomeKind };

export type WorkOriginFetchOutcome =
    | { kind: 'ok'; items: TdahWorkOriginItem[] }
    | { kind: 'invalid-credentials' }
    | { kind: 'unreachable' };

/**
 * The injected `fetch`. Every provider takes it as a parameter rather than
 * closing over the global, so the tick and the routes can be tested against a
 * fake without a network, a port, or a mocked global — the same dependency
 * injection `activity-trigger.ts` uses for `hasOpenConnection`.
 */
export type WorkOriginFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type WorkOriginProvider = {
    id: TdahWorkOriginProvider;
    /** Normalized `https://host` origin, or `null` when the input is not a legitimate site URL for this provider. Never performs I/O. */
    parseSiteUrl: (raw: string) => string | null;
    validateCredentials: (credentials: WorkOriginCredentials, fetchImpl: WorkOriginFetch) => Promise<WorkOriginValidateOutcome>;
    fetchWorkItems: (credentials: WorkOriginCredentials, fetchImpl: WorkOriginFetch) => Promise<WorkOriginFetchOutcome>;
    /** The effective query, as plain selectable text for T-13. Pure — no I/O, no credentials. */
    describeQuery: () => string;
};

const WORK_ORIGIN_PROVIDER_LIST: WorkOriginProvider[] = [jiraWorkOriginProvider];

export const WORK_ORIGIN_PROVIDERS: Record<TdahWorkOriginProvider, WorkOriginProvider> = Object.fromEntries(
    WORK_ORIGIN_PROVIDER_LIST.map((provider) => [provider.id, provider]),
) as Record<TdahWorkOriginProvider, WorkOriginProvider>;

/**
 * `undefined` for an id that isn't registered. Callers persist only ids that
 * resolved here, so a stored row can only ever reference a live provider —
 * except across a downgrade, which is why the pull tick re-resolves on every
 * tick instead of trusting the column.
 */
export const resolveWorkOriginProvider = (id: string): WorkOriginProvider | undefined => (
    (WORK_ORIGIN_PROVIDERS as Record<string, WorkOriginProvider>)[id]
);
