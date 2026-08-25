import { useCallback, useEffect, useRef, useState } from 'react';

import { cloudGetJson, cloudRequestJson, getCloudBaseUrl, getTranslator } from '@mindwtr/core';

import { getCurrentUiLanguage } from '../../../contexts/language-context';
import { getTauriHttpFetch } from '../../../lib/tauri-http';
import { SyncService } from '../../../lib/sync-service';
import { SettingsCard, SettingsSectionHeader } from './SettingRow';

/**
 * PWA/desktop activation of ADHD mode (T-14, spec 1.3): a single step (tz +
 * ritual hour, no permissions, no Routine) — the mobile counterpart runs a
 * 5-step onboarding, but per UX spec 07 the PWA is "activación simple sin
 * permisos". Calls the same idempotent `POST /v1/tdah/activate` the mobile
 * onboarding and reactivation flow use, without a `routine`.
 *
 * Self-contained by design: it resolves its own i18n via `getTranslator` /
 * `getCurrentUiLanguage` instead of the `t: Labels` prop `SettingsMainPage`
 * threads for everything else, because that prop's shape is built by
 * `labels.ts` / `useSettingsMainPage.ts`, which this story does not own.
 */

const TDAH_PROFILE_PATH = '/tdah/profile';
const TDAH_ACTIVATE_PATH = '/tdah/activate';
const TDAH_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RITUAL_HOUR = '23:00';
const DEVICE_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;

type TdahProfileState = {
    mode: 'on' | 'off';
    timeZone: string;
    ritualHour: string;
};

type TdahActivationPhase = 'loading' | 'no-sync' | 'ready' | 'error';

type CloudConnection = {
    url: string;
    token: string;
    allowInsecureHttp: boolean;
};

const detectDeviceTimeZone = (): string => {
    try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return timeZone && DEVICE_TIME_ZONE_PATTERN.test(timeZone) ? timeZone : 'UTC';
    } catch {
        return 'UTC';
    }
};

const buildTdahUrl = (cloudUrl: string, path: string): string => `${getCloudBaseUrl(cloudUrl)}${path}`;

const inputCls =
    'text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed';

export function TdahActivationSection() {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);

    const [phase, setPhase] = useState<TdahActivationPhase>('loading');
    const [cloud, setCloud] = useState<CloudConnection | null>(null);
    const [profile, setProfile] = useState<TdahProfileState | null>(null);
    const [timeZone, setTimeZone] = useState<string>(() => detectDeviceTimeZone());
    const [ritualHour, setRitualHour] = useState<string>(DEFAULT_RITUAL_HOUR);
    const [activating, setActivating] = useState(false);
    const [activateFailed, setActivateFailed] = useState(false);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const buildOptions = useCallback(async (config: CloudConnection) => ({
        token: config.token,
        allowInsecureHttp: config.allowInsecureHttp,
        timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
        fetcher: (await getTauriHttpFetch()) ?? fetch,
    }), []);

    const loadProfile = useCallback(async (config: CloudConnection): Promise<void> => {
        const options = await buildOptions(config);
        const result = await cloudGetJson<{ profile: TdahProfileState | null }>(
            buildTdahUrl(config.url, TDAH_PROFILE_PATH),
            options,
        );
        if (!mountedRef.current) return;
        const nextProfile = result?.profile ?? null;
        setProfile(nextProfile);
        if (nextProfile) {
            setTimeZone(nextProfile.timeZone);
            setRitualHour(nextProfile.ritualHour);
        }
        setPhase('ready');
    }, [buildOptions]);

    const reload = useCallback(async (): Promise<void> => {
        setPhase('loading');
        setActivateFailed(false);
        try {
            const config = await SyncService.getCloudConfig({ silent: true });
            const url = config.url?.trim() ?? '';
            const token = config.token?.trim() ?? '';
            if (!mountedRef.current) return;
            if (!url || !token) {
                setCloud(null);
                setProfile(null);
                setPhase('no-sync');
                return;
            }
            const next: CloudConnection = { url, token, allowInsecureHttp: config.allowInsecureHttp === true };
            setCloud(next);
            await loadProfile(next);
        } catch {
            if (!mountedRef.current) return;
            setProfile(null);
            setPhase('error');
        }
    }, [loadProfile]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const handleActivate = useCallback(async () => {
        if (!cloud || activating) return;
        setActivating(true);
        setActivateFailed(false);
        try {
            const options = await buildOptions(cloud);
            const result = await cloudRequestJson<{ profile: TdahProfileState }>(
                'POST',
                buildTdahUrl(cloud.url, TDAH_ACTIVATE_PATH),
                { timeZone, ritualHour },
                options,
            );
            if (!mountedRef.current) return;
            const nextProfile = result?.profile ?? { mode: 'on' as const, timeZone, ritualHour };
            setProfile(nextProfile);
            setTimeZone(nextProfile.timeZone);
            setRitualHour(nextProfile.ritualHour);
        } catch {
            if (!mountedRef.current) return;
            setActivateFailed(true);
        } finally {
            if (mountedRef.current) setActivating(false);
        }
    }, [activating, buildOptions, cloud, ritualHour, timeZone]);

    const isActive = profile?.mode === 'on';

    return (
        <>
            <SettingsSectionHeader>{t('settings.tdah.title')}</SettingsSectionHeader>
            <SettingsCard>
                {phase === 'loading' ? (
                    <div className="p-4 text-[13px] text-muted-foreground">{t('settings.tdah.loading')}</div>
                ) : null}
                {phase === 'no-sync' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('settings.tdah.enable')}</div>
                        <div className="text-xs text-muted-foreground">{t('settings.tdah.needsSync')}</div>
                    </div>
                ) : null}
                {phase === 'error' ? (
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-muted-foreground">{t('settings.tdah.loadError')}</div>
                        <button
                            type="button"
                            onClick={() => void reload()}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                            {t('settings.tdah.retry')}
                        </button>
                    </div>
                ) : null}
                {phase === 'ready' && isActive ? (
                    <>
                        <div className="p-4 space-y-1">
                            <div className="text-sm font-medium">{t('settings.tdah.title')}</div>
                            <div className="text-xs text-muted-foreground">{t('settings.tdah.activatePwaDone')}</div>
                        </div>
                        <div className="p-4 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-sm font-medium">{t('settings.tdah.timeZone')}</div>
                                <div className="text-xs text-muted-foreground mt-1">{t('settings.tdah.timeZoneDesc')}</div>
                            </div>
                            <span className="text-[13px] text-muted-foreground shrink-0">{profile?.timeZone}</span>
                        </div>
                        <div className="p-4 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-sm font-medium">{t('settings.tdah.ritualHour')}</div>
                                <div className="text-xs text-muted-foreground mt-1">{t('settings.tdah.ritualHourDesc')}</div>
                            </div>
                            <span className="text-[13px] text-muted-foreground shrink-0">{profile?.ritualHour}</span>
                        </div>
                    </>
                ) : null}
                {phase === 'ready' && !isActive ? (
                    <div className="p-4 space-y-4">
                        <div>
                            <div className="text-sm font-medium">{t('settings.tdah.activatePwaTitle')}</div>
                            <div className="text-xs text-muted-foreground mt-1">{t('settings.tdah.activatePwaBody')}</div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">{t('tdahOnboarding.step2TimeZoneLabel')}</span>
                                <input
                                    type="text"
                                    aria-label={t('tdahOnboarding.step2TimeZoneLabel')}
                                    value={timeZone}
                                    disabled={activating}
                                    onChange={(e) => setTimeZone(e.target.value)}
                                    className={inputCls}
                                />
                                <span className="text-xs text-muted-foreground">{t('tdahOnboarding.step2TimeZoneDetected')}</span>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">{t('settings.tdah.ritualHour')}</span>
                                <input
                                    type="time"
                                    aria-label={t('settings.tdah.ritualHour')}
                                    value={ritualHour}
                                    disabled={activating}
                                    onChange={(e) => setRitualHour(e.target.value)}
                                    className={inputCls}
                                />
                                <span className="text-xs text-muted-foreground">{t('settings.tdah.ritualHourDesc')}</span>
                            </label>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => void handleActivate()}
                                disabled={activating}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {activating ? t('settings.tdah.activatePwaBusy') : t('settings.tdah.activatePwaButton')}
                            </button>
                            {activateFailed ? (
                                <span className="text-xs text-destructive">{t('settings.tdah.activatePwaError')}</span>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </SettingsCard>
        </>
    );
}
