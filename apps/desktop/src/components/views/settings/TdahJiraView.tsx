import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    CloudHttpError,
    cloudGetJson,
    cloudRequestJson,
    formatI18nTemplate,
    getCloudBaseUrl,
    getTranslator,
} from '@mindwtr/core';

import { getCurrentUiLanguage } from '../../../contexts/language-context';
import { getTauriHttpFetch } from '../../../lib/tauri-http';
import { SyncService } from '../../../lib/sync-service';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { SettingsCard, SettingsSectionHeader } from './SettingRow';
import { TDAH_REQUEST_TIMEOUT_MS, type CloudConnection } from './TdahRoutinesListView';

/**
 * T-13 (spec 4.1): "Conectar mi Jira — el Origen de trabajo". Self-contained
 * like `TdahMetricsView`/`TdahHistoryView`: resolves its own cloud config and
 * i18n rather than threading through `SettingsMainPage`'s `t: Labels` prop,
 * and reads the mode gate straight off the 409 `TDAH_ACTIVATE_REQUIRED` the
 * server answers with (no separate profile fetch).
 *
 * The server side of `/v1/tdah/origin*` (apps/cloud/src/tdah/) was being built
 * in parallel by a different agent from the same spec and did not exist on
 * disk when this file was written, so every shape below is hand-derived from
 * spec-4-1's I/O & Edge-Case Matrix — the same "kept in sync by hand, ADR
 * 0026" convention the other TDAH views already document (desktop views never
 * import server types).
 *
 * Security shape of this screen (AD-9, spec's "Always"/"Never" lists):
 * - the API token is *write-only*. Its input never receives a `value` derived
 *   from any server response, it is cleared the moment a save succeeds, and no
 *   response shape modelled here has a token field at any level.
 * - nothing here is logged; failures are rendered as copy keyed off the HTTP
 *   status or the server's `lastErrorCode`, never off a response body.
 */

export type TdahWorkOriginProvider = 'jira';

export type TdahWorkOriginItem = {
    externalKey: string;
    summary: string;
    status: string;
    sprintName: string | null;
};

/**
 * `GET`/`PUT /v1/tdah/origin` and `POST /v1/tdah/origin/sync` all answer with
 * the public origin status. Deliberately has no token field at any level —
 * the spec's matrix row for the read is explicit: "**sin campo de token en
 * ningún nivel**".
 */
export type TdahWorkOriginResponse = {
    connected: boolean;
    provider: TdahWorkOriginProvider | null;
    siteUrl: string | null;
    email: string | null;
    // Null in the disconnected state — which is the first state this screen
    // renders. The server's `TdahWorkOriginStatus` nulls every settings field
    // until a credential exists; the defaults below are this screen's, not the
    // server's, and are only what the form is seeded with.
    jql: string | null;
    workStart: string | null;
    workEnd: string | null;
    pullIntervalMinutes: number | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    lastErrorCode: string | null;
    issues: TdahWorkOriginItem[];
};

type TdahJiraPhase = 'loading' | 'no-sync' | 'inactive' | 'ready' | 'error';

export const TDAH_ORIGIN_PATH = '/tdah/origin';
export const TDAH_ORIGIN_SYNC_PATH = '/tdah/origin/sync';

// Only used before the server has ever answered (or if it answers without a
// `jql`): the query is server-owned text, this is a last-resort mirror of the
// constant the spec pins in `jira-origin.ts` so zone 4 is never blank.
export const TDAH_JIRA_FALLBACK_JQL =
    'assignee = currentUser() AND sprint in openSprints() AND statusCategory != Done ORDER BY updated ASC';

export const TDAH_ORIGIN_DEFAULT_WORK_START = '09:00';
export const TDAH_ORIGIN_DEFAULT_WORK_END = '18:00';
export const TDAH_ORIGIN_DEFAULT_PULL_INTERVAL_MINUTES = 120;

const PULL_INTERVAL_HOUR_CHOICES = [1, 2, 4, 8];

const buildTdahUrl = (cloudUrl: string, path: string): string => `${getCloudBaseUrl(cloudUrl)}${path}`;

const buildCloudRequestOptions = async (config: CloudConnection) => ({
    token: config.token,
    allowInsecureHttp: config.allowInsecureHttp,
    timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
    fetcher: (await getTauriHttpFetch()) ?? fetch,
});

const isActivateRequiredError = (error: unknown): boolean => error instanceof CloudHttpError && error.status === 409;

const IPV4_HOST_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

// A Jira Cloud site is a public `*.atlassian.net`-shaped host. These suffixes
// only ever name something on the operator's own network, and letting one
// through would aim the server's outbound GET at its own LAN.
const NON_PUBLIC_HOST_SUFFIXES = ['.local', '.internal', '.home.arpa', '.localhost'];

/**
 * Mirrors the rules `parseJiraSiteUrl` enforces server-side: `https:` only, no
 * userinfo, no path/query/fragment, no explicit port, a dotted public host, and
 * no IP literal or private-network suffix. Client-side it exists so a shape the
 * server will reject never leaves the device — anything looser would surface
 * the server's 400 as "your token is broken", which is the wrong story. The
 * server's own `TDAH_ORIGIN_INVALID` remains the authority, exactly like
 * `isValidCustomPeriodRange` in `tdah-period-range.ts`.
 */
export const isValidJiraSiteUrl = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    if (url.search !== '' || url.hash !== '') return false;
    if (url.pathname !== '' && url.pathname !== '/') return false;
    if (url.port !== '') return false;
    const host = url.hostname.toLowerCase();
    // `URL.hostname` keeps the brackets on an IPv6 literal.
    if (host.startsWith('[')) return false;
    if (IPV4_HOST_PATTERN.test(host)) return false;
    if (!host.includes('.')) return false;
    return !NON_PUBLIC_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
};

export const isValidJiraAccountEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const WORK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The pull gate compares `computeLocalTimeOfDay(tz, now)` lexicographically
 * against these two strings, so they must be zero-padded `HH:mm` and the start
 * must sort before the end — an inverted or equal window is a window the tick
 * can never be inside, and the band would have a non-positive duration.
 */
export const isValidWorkWindow = (start: string, end: string): boolean => {
    if (!WORK_TIME_PATTERN.test(start) || !WORK_TIME_PATTERN.test(end)) return false;
    return start < end;
};

// Deliberately permissive: the select only ever offers the fixed ladder plus
// whatever the server itself reported, so this is a floor guard against an
// empty/NaN/negative value, not a second opinion on the server's own setting.
export const isValidPullIntervalMinutes = (minutes: number): boolean =>
    Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;

const ORIGIN_ERROR_MESSAGE_KEYS: Record<string, string> = {
    TDAH_ORIGIN_CREDENTIALS_INVALID: 'tdahJira.error.credentials',
    TDAH_ORIGIN_UNREACHABLE: 'tdahJira.error.unreachable',
    TDAH_ORIGIN_KEY_UNAVAILABLE: 'tdahJira.error.keyUnavailable',
    // The pull reached Jira fine; the day had no room left for the band
    // (`TDAH_DAY_MAX_ACTIVITIES`). Nothing about the credential is wrong, so
    // the generic degraded-pull copy would send the user hunting for the
    // wrong problem.
    TDAH_ORIGIN_DAY_FULL: 'tdahJira.error.dayFull',
};

/**
 * A persisted `lastErrorCode` this build does not know about still has to say
 * *something* actionable rather than silently reading as a healthy connection.
 * "Your server could not reach Jira. Your personal activities keep running as
 * usual." is the honest superset of every origin failure: degraded pull,
 * personal Actividades intact.
 */
const lastErrorMessageKey = (code: string | null | undefined): string | null => (
    code ? (ORIGIN_ERROR_MESSAGE_KEYS[code] ?? 'tdahJira.error.unreachable') : null
);

/**
 * The error envelope is `{error: {code}}` (an object), and `cloudRequestJson`
 * only lifts a *string* `error` into the thrown message — so the code never
 * reaches the client and the status line is all there is to key off.
 *
 * `TDAH_ORIGIN_INVALID` and `TDAH_ORIGIN_CREDENTIALS_INVALID` share status
 * 400. This screen resolves that collision by refusing to submit *any* field
 * the server would reject as malformed — site URL, email, working window and
 * pull interval alike (see `canSubmit` below) — so a 400 that survives local
 * validation is the credentials one in practice. Every field the PUT body
 * carries must be covered: a gap here does not merely weaken validation, it
 * renames someone's inverted working window "your token no longer works".
 */
const saveErrorKeyForStatus = (status: number): string => {
    if (status === 400) return 'tdahJira.error.credentials';
    if (status === 502 || status === 504) return 'tdahJira.error.unreachable';
    if (status === 503) return 'tdahJira.error.keyUnavailable';
    return 'tdahJira.form.saveError';
};

const formatTimestamp = (value: string, locale: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const formatIntervalHours = (minutes: number): string => {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
};

// A status envelope is only trusted to replace local state if it actually
// looks like one; anything else falls back to a plain re-read of GET.
const isOriginResponse = (value: unknown): value is TdahWorkOriginResponse =>
    typeof value === 'object' && value !== null && typeof (value as TdahWorkOriginResponse).connected === 'boolean';

export function TdahJiraView() {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);

    const [phase, setPhase] = useState<TdahJiraPhase>('loading');
    const [origin, setOrigin] = useState<TdahWorkOriginResponse | null>(null);
    const [cloud, setCloud] = useState<CloudConnection | null>(null);
    const [isOffline, setIsOffline] = useState(false);

    // Write-only credential form. `token` is never seeded from a response and
    // is wiped as soon as a save succeeds.
    const [siteUrl, setSiteUrl] = useState('');
    const [email, setEmail] = useState('');
    const [token, setToken] = useState('');
    const [workStart, setWorkStart] = useState(TDAH_ORIGIN_DEFAULT_WORK_START);
    const [workEnd, setWorkEnd] = useState(TDAH_ORIGIN_DEFAULT_WORK_END);
    const [pullIntervalMinutes, setPullIntervalMinutes] = useState(TDAH_ORIGIN_DEFAULT_PULL_INTERVAL_MINUTES);

    const [isSaving, setIsSaving] = useState(false);
    const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [disconnectFailed, setDisconnectFailed] = useState(false);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Seeds the non-secret half of the form from the server's own state. The
    // token is pointedly absent: there is nothing to seed it from.
    const applyOrigin = useCallback((next: TdahWorkOriginResponse): void => {
        setOrigin(next);
        setSiteUrl(next.siteUrl ?? '');
        setEmail(next.email ?? '');
        setWorkStart(next.workStart || TDAH_ORIGIN_DEFAULT_WORK_START);
        setWorkEnd(next.workEnd || TDAH_ORIGIN_DEFAULT_WORK_END);
        setPullIntervalMinutes(next.pullIntervalMinutes || TDAH_ORIGIN_DEFAULT_PULL_INTERVAL_MINUTES);
    }, []);

    const load = useCallback(async (config: CloudConnection): Promise<void> => {
        const options = await buildCloudRequestOptions(config);
        const result = await cloudGetJson<TdahWorkOriginResponse>(
            buildTdahUrl(config.url, TDAH_ORIGIN_PATH),
            options,
        );
        if (!mountedRef.current) return;
        if (result) applyOrigin(result);
        else setOrigin(null);
        setPhase('ready');
    }, [applyOrigin]);

    const reload = useCallback(async (): Promise<void> => {
        setPhase('loading');
        try {
            const config = await SyncService.getCloudConfig({ silent: true });
            const url = config.url?.trim() ?? '';
            const cloudToken = config.token?.trim() ?? '';
            if (!mountedRef.current) return;
            if (!url || !cloudToken) {
                setCloud(null);
                setOrigin(null);
                setPhase('no-sync');
                return;
            }
            const next: CloudConnection = { url, token: cloudToken, allowInsecureHttp: config.allowInsecureHttp === true };
            setCloud(next);
            await load(next);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isActivateRequiredError(error)) {
                setOrigin(null);
                setPhase('inactive');
                return;
            }
            setPhase('error');
        }
    }, [load]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // Offline: pause automatic reloads and keep the last loaded status on
    // screen behind a banner — same pattern as the other TDAH views.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleOnline = () => {
            setIsOffline(false);
            void reload();
        };
        const handleOffline = () => setIsOffline(true);
        setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [reload]);

    const connected = origin?.connected === true;
    const issues = useMemo(() => origin?.issues ?? [], [origin]);
    const sprintNames = useMemo(
        () => new Set(issues.map((issue) => issue.sprintName).filter((name): name is string => !!name)),
        [issues],
    );
    const lastErrorKey = lastErrorMessageKey(origin?.lastErrorCode);
    // `jql` is null until a credential exists — zone 4 still has to show the
    // query that *will* run, so the pinned constant stands in.
    const jqlText = origin?.jql && origin.jql.trim() ? origin.jql : TDAH_JIRA_FALLBACK_JQL;

    const intervalChoices = useMemo(() => {
        const minutes = new Set(PULL_INTERVAL_HOUR_CHOICES.map((hours) => hours * 60));
        // A server-side value outside the fixed ladder (an operator default, a
        // future setting) must stay selectable instead of being silently
        // rewritten to 2 h by the next save.
        if (pullIntervalMinutes > 0) minutes.add(pullIntervalMinutes);
        return Array.from(minutes).sort((a, b) => a - b);
    }, [pullIntervalMinutes]);

    const siteUrlValid = isValidJiraSiteUrl(siteUrl);
    const emailValid = isValidJiraAccountEmail(email);
    // Every field the PUT body carries is validated, not just the credential
    // half: an inverted or cleared working window is a 400 the user would
    // otherwise read as "your token no longer works".
    const workWindowValid = isValidWorkWindow(workStart, workEnd);
    const intervalValid = isValidPullIntervalMinutes(pullIntervalMinutes);
    const scheduleValid = workWindowValid && intervalValid;
    /**
     * Once an origin row exists the server accepts a PUT with no `token` at
     * all: it carries the sealed secret forward byte-for-byte (same nonce, no
     * re-seal) and skips revalidation, so cadence and window can be edited
     * without re-typing the credential. A *first* connection still needs one,
     * and a present-but-empty token is invalid to the parser — hence the key
     * is omitted from the body entirely rather than sent as `''`.
     */
    const tokenRequired = !connected;
    const tokenProvided = token.trim().length > 0;
    const canSubmit = siteUrlValid && emailValid && (tokenProvided || !tokenRequired) && scheduleValid && !isSaving;

    const handleSave = useCallback(async (): Promise<void> => {
        if (!cloud || !canSubmit) return;
        setIsSaving(true);
        setSaveErrorKey(null);
        try {
            const options = await buildCloudRequestOptions(cloud);
            const result = await cloudRequestJson<TdahWorkOriginResponse>(
                'PUT',
                buildTdahUrl(cloud.url, TDAH_ORIGIN_PATH),
                {
                    provider: 'jira',
                    siteUrl: siteUrl.trim(),
                    email: email.trim(),
                    // Omitted, never `''`: an empty token is invalid to the
                    // parser, while an absent one means "keep the sealed
                    // secret you already hold".
                    ...(tokenProvided ? { token } : {}),
                    workStart,
                    workEnd,
                    pullIntervalMinutes,
                },
                options,
            );
            if (!mountedRef.current) return;
            // Wiped on success, before anything is rendered from the response:
            // the token is entered once and never re-shown (AD-9).
            setToken('');
            if (isOriginResponse(result)) applyOrigin(result);
            else await load(cloud);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isActivateRequiredError(error)) {
                setPhase('inactive');
                return;
            }
            setSaveErrorKey(error instanceof CloudHttpError ? saveErrorKeyForStatus(error.status) : 'tdahJira.form.saveError');
        } finally {
            if (mountedRef.current) setIsSaving(false);
        }
    }, [applyOrigin, canSubmit, cloud, email, load, pullIntervalMinutes, siteUrl, token, tokenProvided, workEnd, workStart]);

    const handleSyncNow = useCallback(async (): Promise<void> => {
        if (!cloud || isSyncing) return;
        setIsSyncing(true);
        setSaveErrorKey(null);
        try {
            const options = await buildCloudRequestOptions(cloud);
            const result = await cloudRequestJson<TdahWorkOriginResponse>(
                'POST',
                buildTdahUrl(cloud.url, TDAH_ORIGIN_SYNC_PATH),
                undefined,
                options,
            );
            if (!mountedRef.current) return;
            if (isOriginResponse(result)) applyOrigin(result);
            else await load(cloud);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isActivateRequiredError(error)) {
                setPhase('inactive');
                return;
            }
            setSaveErrorKey(error instanceof CloudHttpError ? saveErrorKeyForStatus(error.status) : 'tdahJira.form.saveError');
        } finally {
            if (mountedRef.current) setIsSyncing(false);
        }
    }, [applyOrigin, cloud, isSyncing, load]);

    const handleConfirmDisconnect = useCallback(async (): Promise<void> => {
        if (!cloud || isDisconnecting) return;
        setIsDisconnecting(true);
        setDisconnectFailed(false);
        try {
            const options = await buildCloudRequestOptions(cloud);
            await cloudRequestJson('DELETE', buildTdahUrl(cloud.url, TDAH_ORIGIN_PATH), undefined, options);
            if (!mountedRef.current) return;
            setConfirmingDisconnect(false);
            setToken('');
            setSaveErrorKey(null);
            // Cleared here, not left to the re-read: if the follow-up GET
            // fails (or 409s because the mode is off), the screen must not
            // keep advertising a connection to an origin that is gone.
            setOrigin(null);
        } catch {
            if (!mountedRef.current) return;
            setDisconnectFailed(true);
            return;
        } finally {
            if (mountedRef.current) setIsDisconnecting(false);
        }
        // The disconnect itself succeeded — a reload failure here must not
        // flip it back to a reported failure.
        await load(cloud).catch(() => undefined);
    }, [cloud, isDisconnecting, load]);

    /**
     * The only path to revoking a stored credential, so it is deliberately not
     * confined to the healthy `ready` view. `GET /v1/tdah/origin` is mode-gated
     * and `DELETE` is not — exactly so a token stays revocable after the mode is
     * switched off — and that server-side exemption is worthless if turning the
     * mode off (409 → `inactive`) or a failed read (`error`) hides the button.
     */
    const disconnectButton = (
        <button
            type="button"
            onClick={() => { setConfirmingDisconnect(true); setDisconnectFailed(false); }}
            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-destructive hover:bg-destructive/10 transition-colors"
        >
            {t('tdahJira.disconnect.action')}
        </button>
    );

    return (
        <>
            <SettingsSectionHeader>{t('tdahJira.title')}</SettingsSectionHeader>
            <SettingsCard>
                {phase === 'loading' ? (
                    <div className="p-4 text-[13px] text-muted-foreground">{t('tdahJira.loading')}</div>
                ) : null}
                {phase === 'no-sync' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahJira.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahJira.needsSync')}</div>
                    </div>
                ) : null}
                {phase === 'inactive' ? (
                    <div className="p-4 space-y-2">
                        <div className="text-sm font-medium">{t('tdahJira.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahJira.inactive')}</div>
                        {cloud ? disconnectButton : null}
                    </div>
                ) : null}
                {phase === 'error' ? (
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-muted-foreground">{t('tdahJira.loadError')}</div>
                        <div className="flex items-center gap-2 shrink-0">
                            {cloud ? disconnectButton : null}
                            <button
                                type="button"
                                onClick={() => void reload()}
                                className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            >
                                {t('tdahJira.retry')}
                            </button>
                        </div>
                    </div>
                ) : null}
                {phase === 'ready' ? (
                    <>
                        {isOffline ? (
                            <div className="p-3 text-xs text-muted-foreground bg-muted/30">
                                {t('tdahJira.offlineBanner')}
                            </div>
                        ) : null}

                        {/* Zone 1 — connection status: the thing the user comes
                            here to read when something has gone wrong. */}
                        <div className="p-4 space-y-1.5 border-b border-border">
                            <div className="text-sm font-medium">{t('tdahJira.status.title')}</div>
                            {connected && origin?.siteUrl ? (
                                <div className="text-[13px]" data-testid="tdah-jira-status">
                                    {formatI18nTemplate(t('tdahJira.status.connected'), { site: origin.siteUrl })}
                                </div>
                            ) : (
                                <div className="text-[13px] text-muted-foreground" data-testid="tdah-jira-status">
                                    {t('tdahJira.status.disconnected')}
                                </div>
                            )}
                            {connected && origin?.email ? (
                                <div className="text-xs text-muted-foreground">
                                    {formatI18nTemplate(t('tdahJira.status.account'), { email: origin.email })}
                                </div>
                            ) : null}
                            {connected ? (
                                <div className="text-xs text-muted-foreground">
                                    {isSyncing
                                        ? t('tdahJira.status.syncing')
                                        : origin?.lastSyncAt
                                            ? formatI18nTemplate(t('tdahJira.status.lastSync'), {
                                                when: formatTimestamp(origin.lastSyncAt, language),
                                            })
                                            : t('tdahJira.status.neverSynced')}
                                </div>
                            ) : null}
                            {connected && !lastErrorKey ? (
                                <div className="text-xs text-muted-foreground">
                                    {issues.length === 0
                                        ? t('tdahJira.status.noSprint')
                                        : formatI18nTemplate(t('tdahJira.status.taskCount'), { count: issues.length })}
                                </div>
                            ) : null}
                            {connected && sprintNames.size > 1 ? (
                                <div className="text-xs text-muted-foreground">{t('tdahJira.status.multiSprint')}</div>
                            ) : null}
                            {lastErrorKey ? (
                                <div className="text-xs text-destructive" data-testid="tdah-jira-last-error">{t(lastErrorKey)}</div>
                            ) : null}
                            <p className="text-xs text-muted-foreground pt-1">{t('tdahJira.privacy')}</p>
                            <p className="text-xs text-muted-foreground">{t('tdahJira.readOnly')}</p>
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void handleSave();
                            }}
                        >
                            {/* Zone 2 — the credential form. Short and serious:
                                it is a work credential (doc 06). */}
                            <div className="p-4 space-y-3 border-b border-border">
                                <div className="text-sm font-medium">{t('tdahJira.form.title')}</div>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahJira.form.siteUrl')}</span>
                                    <input
                                        type="url"
                                        aria-label={t('tdahJira.form.siteUrl')}
                                        value={siteUrl}
                                        onChange={(e) => setSiteUrl(e.target.value)}
                                        placeholder="https://yourcompany.atlassian.net"
                                        autoComplete="off"
                                        className="bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5 text-[13px] font-mono"
                                    />
                                    <span className="text-xs text-muted-foreground">{t('tdahJira.form.siteUrlHint')}</span>
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahJira.form.email')}</span>
                                    <input
                                        type="email"
                                        aria-label={t('tdahJira.form.email')}
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="off"
                                        className="bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5 text-[13px] font-mono"
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahJira.form.token')}</span>
                                    <input
                                        // Never `value={something from the server}`: the only
                                        // source of this field is what the user typed in this
                                        // session, and it is cleared on a successful save.
                                        type="password"
                                        aria-label={t('tdahJira.form.token')}
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder={connected
                                            ? t('tdahJira.form.tokenStoredPlaceholder')
                                            : t('tdahJira.form.tokenNewPlaceholder')}
                                        autoComplete="new-password"
                                        spellCheck={false}
                                        className="bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5 text-[13px] font-mono"
                                    />
                                    <span className="text-xs text-muted-foreground">{t('tdahJira.form.tokenHint')}</span>
                                </label>
                                {(siteUrl.trim() && !siteUrlValid) || (email.trim() && !emailValid) ? (
                                    <div className="text-xs text-destructive">{t('tdahJira.form.invalid')}</div>
                                ) : null}
                                {saveErrorKey ? (
                                    <div className="text-xs text-destructive" data-testid="tdah-jira-save-error">{t(saveErrorKey)}</div>
                                ) : null}
                            </div>

                            {/* Zone 3 — pull cadence and the working window the
                                band is anchored to. Saved together with the
                                credential: the server's PUT takes the whole
                                origin, token included, in one body. */}
                            <div className="p-4 space-y-3 border-b border-border">
                                <div className="text-sm font-medium">{t('tdahJira.sync.title')}</div>
                                <div className="flex flex-wrap items-end gap-3">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-muted-foreground">{t('tdahJira.sync.interval')}</span>
                                        <select
                                            aria-label={t('tdahJira.sync.interval')}
                                            value={pullIntervalMinutes}
                                            onChange={(e) => setPullIntervalMinutes(Number(e.target.value))}
                                            className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                        >
                                            {intervalChoices.map((minutes) => (
                                                <option key={minutes} value={minutes}>
                                                    {formatI18nTemplate(t('tdahJira.sync.intervalHours'), {
                                                        hours: formatIntervalHours(minutes),
                                                    })}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    {/* The window is one control in two boxes;
                                        `from`/`to` name each box because
                                        `tdahJira.sync.window` names the pair. */}
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs text-muted-foreground">{t('tdahJira.sync.window')}</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="time"
                                                aria-label={t('tdahHistory.filters.from')}
                                                value={workStart}
                                                onChange={(e) => setWorkStart(e.target.value)}
                                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                            />
                                            <span className="text-xs text-muted-foreground">–</span>
                                            <input
                                                type="time"
                                                aria-label={t('tdahHistory.filters.to')}
                                                value={workEnd}
                                                onChange={(e) => setWorkEnd(e.target.value)}
                                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground">{t('tdahJira.sync.windowHint')}</div>
                                {scheduleValid ? null : (
                                    <div className="text-xs text-destructive" data-testid="tdah-jira-schedule-error">
                                        {t('tdahJira.form.invalid')}
                                    </div>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="submit"
                                        disabled={!canSubmit}
                                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                                    >
                                        {isSaving
                                            ? t('tdahJira.form.saving')
                                            : connected ? t('tdahJira.form.update') : t('tdahJira.form.save')}
                                    </button>
                                    {connected ? (
                                        <button
                                            type="button"
                                            onClick={() => void handleSyncNow()}
                                            disabled={isSyncing}
                                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                                        >
                                            {isSyncing ? t('tdahJira.status.syncing') : t('tdahJira.sync.now')}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </form>

                        {/* Zone 4 — the exact JQL the server runs, as selectable
                            text (PRD open question #2 stays inspectable). */}
                        <div className="p-4 space-y-1.5 border-b border-border">
                            <div className="text-sm font-medium">{t('tdahJira.jql.title')}</div>
                            <code
                                data-testid="tdah-jira-jql"
                                className="block select-text whitespace-pre-wrap break-words bg-muted/50 border border-border rounded-md px-2.5 py-1.5 text-xs font-mono"
                            >
                                {jqlText}
                            </code>
                            <div className="text-xs text-muted-foreground">{t('tdahJira.jql.hint')}</div>
                        </div>

                        {/* Zone 5 — disconnect, always behind a confirmation. */}
                        {connected ? <div className="p-4">{disconnectButton}</div> : null}
                    </>
                ) : null}
            </SettingsCard>

            {confirmingDisconnect ? (
                <Dialog
                    onClose={() => { if (!isDisconnecting) setConfirmingDisconnect(false); }}
                    labelledBy="tdah-jira-disconnect-title"
                    describedBy="tdah-jira-disconnect-body"
                >
                    <DialogHeader className="px-4 pt-4">
                        <h2 id="tdah-jira-disconnect-title" className="text-sm font-medium">
                            {t('tdahJira.disconnect.title')}
                        </h2>
                    </DialogHeader>
                    <DialogBody className="px-4 py-3 space-y-2">
                        <p id="tdah-jira-disconnect-body" className="text-xs text-muted-foreground">
                            {t('tdahJira.disconnect.body')}
                        </p>
                        {disconnectFailed ? (
                            <p className="text-xs text-destructive">{t('tdahJira.disconnect.error')}</p>
                        ) : null}
                    </DialogBody>
                    <DialogFooter className="px-4 pb-4 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setConfirmingDisconnect(false)}
                            disabled={isDisconnecting}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
                        >
                            {t('tdahJira.disconnect.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleConfirmDisconnect()}
                            disabled={isDisconnecting}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
                        >
                            {t('tdahJira.disconnect.confirm')}
                        </button>
                    </DialogFooter>
                </Dialog>
            ) : null}
        </>
    );
}
