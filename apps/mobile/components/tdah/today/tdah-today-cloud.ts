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
