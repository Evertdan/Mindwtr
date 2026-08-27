import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCloudBaseUrl, type CloudOptions } from '@mindwtr/core';

import { getSecureConfigValue } from '@/lib/secure-config';
import { CLOUD_ALLOW_INSECURE_HTTP_KEY, CLOUD_TOKEN_KEY, CLOUD_URL_KEY } from '@/lib/sync-constants';
import { getMobileCloudRequestOptions } from '@/lib/webdav-request-options';

import type { TdahActivityTransitionAction } from './tdah-today-types';

export type TdahTodayCloudConfig = {
    url: string;
    token: string;
    allowInsecureHttp: boolean;
};

const TDAH_REQUEST_TIMEOUT_MS = 10_000;
const TDAH_PROFILE_PATH = '/tdah/profile';
const TDAH_DAY_PATH = '/tdah/day';
const TDAH_DAY_ACTIVITIES_PATH = '/tdah/day/activities';
// Story 3.3 (T-06/T-07): "mañana"'s own read/write surface, entirely
// separate from TDAH_DAY_PATH's "hoy" endpoints above — T-06 never reuses
// the "hoy" GET (spec Always: computeTomorrowDate, AD-6).
const TDAH_DAY_TOMORROW_PATH = `${TDAH_DAY_PATH}/tomorrow`;
const TDAH_DAY_TOMORROW_ACTIVITIES_PATH = `${TDAH_DAY_TOMORROW_PATH}/activities`;
const TDAH_DAY_TOMORROW_CONFIRM_PATH = `${TDAH_DAY_TOMORROW_PATH}/confirm`;

/**
 * Same cloud-sync-config load shape as tdah-settings-screen.tsx's `reload()`
 * — no client-side caching of the result (AD-1): every caller re-reads it.
 * Returns `null` when Self-Hosted sync isn't configured yet.
 */
export async function loadTdahCloudConfig(): Promise<TdahTodayCloudConfig | null> {
    const [rawUrl, rawToken, rawAllowInsecureHttp] = await Promise.all([
        AsyncStorage.getItem(CLOUD_URL_KEY),
        getSecureConfigValue(CLOUD_TOKEN_KEY),
        AsyncStorage.getItem(CLOUD_ALLOW_INSECURE_HTTP_KEY),
    ]);
    const url = rawUrl?.trim() ?? '';
    const token = rawToken?.trim() ?? '';
    if (!url || !token) return null;
    return { url, token, allowInsecureHttp: rawAllowInsecureHttp === 'true' };
}

export function buildTdahRequestOptions(cloud: TdahTodayCloudConfig): CloudOptions {
    return {
        ...getMobileCloudRequestOptions(cloud.allowInsecureHttp),
        token: cloud.token,
        timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
    };
}

export function buildTdahProfileUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_PROFILE_PATH}`;
}

export function buildTdahDayUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DAY_PATH}`;
}

export function buildTdahDayActivitiesUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DAY_ACTIVITIES_PATH}`;
}

export function buildTdahActivityActionUrl(
    cloudUrl: string,
    activityId: number,
    action: TdahActivityTransitionAction,
): string {
    return `${getCloudBaseUrl(cloudUrl)}/tdah/activities/${activityId}/${action}`;
}

/** T-05's decide endpoint (spec Code Map): `POST /v1/tdah/activities/:id/decide`. */
export function buildTdahActivityDecideUrl(cloudUrl: string, activityId: number): string {
    return `${getCloudBaseUrl(cloudUrl)}/tdah/activities/${activityId}/decide`;
}

/** T-06's read endpoint (spec Code Map): `GET /v1/tdah/day/tomorrow`. */
export function buildTdahTomorrowDayUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DAY_TOMORROW_PATH}`;
}

/** T-06's "Agregar manual" endpoint (spec Code Map): `POST /v1/tdah/day/tomorrow/activities`, independent of the confirm draft. */
export function buildTdahTomorrowActivitiesUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DAY_TOMORROW_ACTIVITIES_PATH}`;
}

/** T-06's grouped confirm endpoint (spec Code Map): `POST /v1/tdah/day/tomorrow/confirm`. */
export function buildTdahTomorrowConfirmUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DAY_TOMORROW_CONFIRM_PATH}`;
}
