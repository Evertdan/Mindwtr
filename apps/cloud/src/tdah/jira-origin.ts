/**
 * The one Origen provider v1 ships: Jira Cloud, read-only (story 4.1, FR-11).
 *
 * Security posture, in one place because it is the whole point of this file:
 *
 * - **Only GET.** Neither exported function issues anything else, and the
 *   `WorkOriginProvider` contract has no write method to implement. "Marcar
 *   ✓ = alerta atendida, no escritura a Jira" (doc 06) is enforced by there
 *   being no code path that could write.
 * - **`redirect: 'manual'`.** `fetch`'s default `'follow'` would replay the
 *   `Authorization` header at whatever host the 3xx names. A tenant that
 *   redirects — or an attacker who can influence the stored site URL — must
 *   never be able to bounce a Basic-auth Jira token somewhere else, so a 3xx
 *   is classified `unreachable` and the response body is dropped unread.
 * - **Its own timeout.** `AbortSignal.timeout` bounds every call
 *   independently of the incoming HTTP request's own signal, so a hung Jira
 *   can never pin a request handler (or a tick) open.
 * - **Nothing from the response escapes.** Outcomes are the three flat
 *   classes `work-origin.ts` defines. No status code, no body fragment, no
 *   URL, no header ever leaves this file — which is what makes "ningún
 *   `logError` del Origen lleva cuerpo de respuesta ni URL de sitio"
 *   structurally true rather than a discipline anyone has to remember.
 */
import type {
    WorkOriginCredentials,
    WorkOriginFetch,
    WorkOriginFetchOutcome,
    WorkOriginProvider,
    WorkOriginValidateOutcome,
} from './work-origin';
import type { TdahWorkOriginItem } from './types';

/**
 * The effective query, exported as text so T-13 can render it verbatim (doc
 * 06 zone 4: "mostrar la consulta que se ejecutará ... dejar visible como
 * texto consultable") and so a test can assert the server asks for exactly
 * this and nothing broader.
 *
 * `sprint in openSprints()` covers the PRD's open question #2 the honest way:
 * it matches EVERY currently-open sprint the user is assigned in, rather than
 * picking one and silently hiding the rest. `statusCategory != Done` keeps
 * finished work out of today's band, and `ORDER BY updated ASC` makes the
 * snapshot's row order stable across pulls (so the band's sub-rows do not
 * shuffle between refreshes).
 */
export const TDAH_JIRA_JQL = 'assignee = currentUser() AND sprint in openSprints() AND statusCategory != Done ORDER BY updated ASC';

/** Per-request ceiling. Generous for one person's open sprint work, bounded so a pathological account cannot make one tick unbounded. */
export const TDAH_JIRA_MAX_ISSUES = 50;
/**
 * Hard ceiling on the bytes we will read from a search response. 50 issues
 * with `fields=summary,status` is a few tens of KB, so 1 MB is generous by
 * two orders of magnitude — but it is the difference between a hostile or
 * misconfigured host (a captive portal streaming forever, a proxy returning a
 * gigabyte of HTML) degrading one namespace's pull and pinning the tick or
 * exhausting the process. Enforced while streaming, so an over-cap body is
 * abandoned rather than buffered first.
 */
export const TDAH_JIRA_MAX_RESPONSE_BYTES = 1_000_000;
/** Both calls are a single small GET; a tenant that cannot answer in 10s is degraded, and the tick will retry on its own schedule. */
export const TDAH_JIRA_REQUEST_TIMEOUT_MS = 10_000;

const JIRA_MYSELF_PATH = '/rest/api/3/myself';
const JIRA_SEARCH_PATH = '/rest/api/3/search/jql';

// Suffixes that only ever name something on the operator's own network. A
// server-side fetcher that will attach a Basic-auth header must never be
// pointed at one of them, and none of them can host a Jira Cloud tenant.
const PRIVATE_HOST_SUFFIXES = [
    '.local',
    '.localhost',
    '.internal',
    '.intranet',
    '.private',
    '.corp',
    '.lan',
    '.home',
    '.home.arpa',
];
// A single DNS label: alphanumeric, inner hyphens allowed, no leading/trailing
// hyphen and no underscore.
const HOST_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// The final label must be a real alphabetic TLD. This one rule is what rules
// out every numeric address form at once — dotted-quad (`169.254.169.254`),
// and the decimal/octal/hex integer forms `URL` also accepts
// (`https://2130706433`, `https://0x7f000001`) — without needing to
// special-case each of them.
const HOST_TLD_PATTERN = /^[a-z]{2,}$/;

/**
 * A legitimate Jira Cloud site URL, normalized to its bare `https://host`
 * origin — or `null`.
 *
 * This function is the SSRF boundary for the whole module: whatever it
 * returns is persisted and later concatenated with `/rest/api/3/...` and
 * handed to `fetch` together with the user's Basic-auth credential. So every
 * rejection below closes a concrete hole rather than being tidiness:
 *
 * - non-`https:` — a Basic-auth token must never cross a cleartext hop.
 * - userinfo (`https://user:pass@host`) — `fetch` would turn that into its
 *   own `Authorization` header, and it is also the classic way to make a URL
 *   *look* like it points at atlassian.net while it does not.
 * - any path/query/fragment — the stored origin is concatenated with a fixed
 *   `/rest/api/3/...` suffix, so a path here would let the caller steer where
 *   the credential is sent (`https://evil.example/?x=` + `/rest/...`).
 * - an explicit port — Jira Cloud is always 443; an arbitrary port is how you
 *   reach an internal service that happens to be listening.
 * - IPv6 literals (`https://[::1]`) — detected by the brackets/colon `URL`
 *   leaves in `hostname`.
 * - IP literals in ANY notation, plus bare single-label names like
 *   `localhost` — both fall out of requiring at least two labels whose last
 *   one is alphabetic (`HOST_TLD_PATTERN`).
 * - private/internal DNS suffixes (`.local`, `.internal`, `.home.arpa`, …) —
 *   the split-horizon equivalent of an RFC1918 address.
 *
 * The link-local metadata address (`169.254.169.254`) is the concrete attack
 * this shape exists to stop: a user-supplied site URL that resolves to it
 * would otherwise make the server fetch its own cloud credentials.
 *
 * Note this is a *syntactic* boundary. It cannot stop a public hostname whose
 * DNS record points at a private address (a DNS-rebinding style trick); that
 * needs resolution-time filtering, which is an operator/network concern
 * (egress policy) rather than something this parser can honestly promise.
 *
 * Exported for direct unit testing, the same way `formatDateInTimeZone` is.
 */
export const parseJiraSiteUrl = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 253) return null;
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.username.length > 0 || url.password.length > 0) return null;
    if (url.port.length > 0) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (url.search.length > 0 || url.hash.length > 0) return null;

    const host = url.hostname.toLowerCase();
    // `URL` renders an IPv6 literal bracketed (`[::1]`); either character is
    // enough to reject the whole family.
    if (host.includes(':') || host.includes('[') || host.includes(']')) return null;
    if (host.startsWith('.') || host.endsWith('.')) return null;
    if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;

    const labels = host.split('.');
    if (labels.length < 2) return null;
    if (!labels.every((label) => HOST_LABEL_PATTERN.test(label))) return null;
    if (!HOST_TLD_PATTERN.test(labels[labels.length - 1] as string)) return null;

    return `https://${host}`;
};

/**
 * Basic auth per Atlassian's documented API-token scheme (`email:token`).
 * Built fresh per call from the just-opened plaintext and never retained.
 */
const buildAuthorizationHeader = (credentials: WorkOriginCredentials): string => (
    `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`, 'utf8').toString('base64')}`
);

const jiraGet = async (
    credentials: WorkOriginCredentials,
    fetchImpl: WorkOriginFetch,
    pathAndQuery: string,
): Promise<Response> => (
    fetchImpl(`${credentials.siteUrl}${pathAndQuery}`, {
        method: 'GET',
        headers: {
            Authorization: buildAuthorizationHeader(credentials),
            Accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(TDAH_JIRA_REQUEST_TIMEOUT_MS),
    })
);

/**
 * The single place an HTTP status becomes an outcome class. 401/403 is the
 * only "the user must act on their credential" signal; a 3xx is refused
 * outright (see this file's header on why we never follow one), and every
 * other non-2xx collapses into `unreachable` — including 404, since a valid
 * token against a site with no Jira mounted is a configuration problem the
 * user resolves the same way as an outage: check the site, try again.
 */
const classifyStatus = (status: number): 'ok' | 'invalid-credentials' | 'unreachable' => {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401 || status === 403) return 'invalid-credentials';
    return 'unreachable';
};

/**
 * GET /rest/api/3/myself — the cheapest authenticated call Jira offers, used
 * purely as a yes/no on the credential before anything is persisted (I/O
 * Matrix: on 401 "nada se persiste; el token anterior queda intacto").
 * The response body is never read.
 */
const validateCredentials = async (
    credentials: WorkOriginCredentials,
    fetchImpl: WorkOriginFetch,
): Promise<WorkOriginValidateOutcome> => {
    try {
        const response = await jiraGet(credentials, fetchImpl, JIRA_MYSELF_PATH);
        return { kind: classifyStatus(response.status) };
    } catch {
        // A throw here is a DNS failure, a TLS failure, a timeout, or an
        // abort. All of them are "the network, not the credential" — and the
        // caught error is dropped rather than inspected, since its message
        // carries the site URL.
        return { kind: 'unreachable' };
    }
};

type JiraIssueFields = {
    summary?: unknown;
    status?: { name?: unknown } | null;
    sprint?: { name?: unknown } | null;
};

type JiraIssue = {
    key?: unknown;
    fields?: JiraIssueFields | null;
};

const asTrimmedString = (value: unknown, maxLength: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, maxLength);
};

const JIRA_KEY_MAX_LENGTH = 64;
const JIRA_SUMMARY_MAX_LENGTH = 255;
const JIRA_STATUS_MAX_LENGTH = 64;
/**
 * What an issue with no readable status name persists as. Deliberately the
 * empty string rather than a word: this value is stored verbatim and rendered
 * in all 20 locales, so any English placeholder ("Unknown") would be
 * untranslatable copy smuggled in through remote data. An empty status is a
 * defined, renderable "no status chip" for the UI.
 */
const JIRA_UNKNOWN_STATUS = '';

/**
 * Reads at most `maxBytes` from `response`, or `null` when the body is larger,
 * absent, or errors mid-stream.
 *
 * `response.json()`/`response.text()` are deliberately NOT used: both buffer
 * the whole body first, so the cap would only be checked after the damage was
 * already done. The `content-length` pre-check short-circuits the honest case;
 * the streaming accumulator covers a chunked response that never declares one.
 */
const readCappedText = async (response: Response, maxBytes: number): Promise<string | null> => {
    const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;

    const body = response.body;
    if (!body) return null;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    } catch {
        // A truncated/aborted stream is degraded, not a credential problem —
        // the caller classifies it as `unreachable`.
        return null;
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
};

/**
 * Maps one raw Jira issue onto the snapshot row, or `null` when it has no
 * usable identity. Every string is trimmed and length-capped here rather than
 * trusted: this is remote data landing in our own SQLite, and the snapshot
 * table has no other gatekeeper.
 *
 * `sprintName` is best-effort by design. The sprint lives on an
 * instance-specific custom field (`customfield_10020` on many tenants, but
 * not contractually), and asking for an unknown field name makes Jira reject
 * the whole search with a 400 — which would trade a nice-to-have label for
 * the entire feature. So the request asks only for fields that are guaranteed
 * to exist, and this reads a `sprint` field opportunistically for the tenants
 * that do expose one under that name. `null` otherwise; the band never
 * depends on it.
 */
const toWorkOriginItem = (raw: unknown): TdahWorkOriginItem | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const issue = raw as JiraIssue;
    const externalKey = asTrimmedString(issue.key, JIRA_KEY_MAX_LENGTH);
    if (!externalKey) return null;
    const fields = issue.fields ?? null;
    return {
        externalKey,
        summary: asTrimmedString(fields?.summary, JIRA_SUMMARY_MAX_LENGTH) ?? externalKey,
        status: asTrimmedString(fields?.status?.name, JIRA_STATUS_MAX_LENGTH) ?? JIRA_UNKNOWN_STATUS,
        sprintName: asTrimmedString(fields?.sprint?.name, JIRA_STATUS_MAX_LENGTH),
    };
};

/**
 * GET /rest/api/3/search/jql — the periodic read behind the band.
 *
 * `fields` is restricted to `summary,status`: asking for less means less of
 * the user's work data crosses onto our disk, and (see `toWorkOriginItem`)
 * asking for more risks a 400 on tenants that name their sprint field
 * differently. A body that parses to something other than the documented
 * `{issues: [...]}` shape is `unreachable`, not an empty snapshot — an
 * unparseable answer must never be mistaken for "the sprint is empty" and
 * silently retire the user's band.
 */
const fetchWorkItems = async (
    credentials: WorkOriginCredentials,
    fetchImpl: WorkOriginFetch,
): Promise<WorkOriginFetchOutcome> => {
    let response: Response;
    try {
        const query = new URLSearchParams({
            jql: TDAH_JIRA_JQL,
            maxResults: String(TDAH_JIRA_MAX_ISSUES),
            fields: 'summary,status',
        });
        response = await jiraGet(credentials, fetchImpl, `${JIRA_SEARCH_PATH}?${query.toString()}`);
    } catch {
        return { kind: 'unreachable' };
    }

    const classified = classifyStatus(response.status);
    if (classified !== 'ok') return { kind: classified };

    const text = await readCappedText(response, TDAH_JIRA_MAX_RESPONSE_BYTES);
    if (text === null) return { kind: 'unreachable' };

    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        return { kind: 'unreachable' };
    }
    if (typeof payload !== 'object' || payload === null) return { kind: 'unreachable' };
    const rawIssues = (payload as { issues?: unknown }).issues;
    if (!Array.isArray(rawIssues)) return { kind: 'unreachable' };

    // Deduped by key, first occurrence wins — so the provider's own
    // `ORDER BY updated ASC` is preserved and a response that repeats an issue
    // (a paging quirk, a proxy replaying a chunk) can never plant two snapshot
    // rows for the same ticket. The cap is applied to the DEDUPED result, so a
    // response padded with one repeated key cannot squeeze out real issues.
    const items: TdahWorkOriginItem[] = [];
    const seenKeys = new Set<string>();
    for (const raw of rawIssues) {
        if (items.length >= TDAH_JIRA_MAX_ISSUES) break;
        const item = toWorkOriginItem(raw);
        if (!item || seenKeys.has(item.externalKey)) continue;
        seenKeys.add(item.externalKey);
        items.push(item);
    }
    return { kind: 'ok', items };
};

export const jiraWorkOriginProvider: WorkOriginProvider = {
    id: 'jira',
    parseSiteUrl: parseJiraSiteUrl,
    validateCredentials,
    fetchWorkItems,
    describeQuery: () => TDAH_JIRA_JQL,
};
