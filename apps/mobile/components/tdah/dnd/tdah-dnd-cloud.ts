import { getCloudBaseUrl } from '@mindwtr/core';

import {
    buildTdahRequestOptions,
    loadTdahCloudConfig,
    type TdahTodayCloudConfig,
} from '../today/tdah-today-cloud';

/**
 * T-12's endpoint builders. The config loader and request-option builder are
 * re-exported from `tdah-today-cloud.ts` rather than copied: they read the
 * one Self-Hosted sync config the whole app shares (AsyncStorage URL +
 * secure token), so a second copy could only ever drift from it.
 */
export type TdahDndCloudConfig = TdahTodayCloudConfig;

export { buildTdahRequestOptions, loadTdahCloudConfig };

const TDAH_DND_PATH = '/tdah/dnd';
const TDAH_DND_WINDOWS_PATH = `${TDAH_DND_PATH}/windows`;
const TDAH_DND_CALENDAR_PATH = `${TDAH_DND_PATH}/calendar`;

/** `GET /v1/tdah/dnd` (state) and `PUT /v1/tdah/dnd` (settings). */
export function buildTdahDndUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DND_PATH}`;
}

/** `POST /v1/tdah/dnd/windows` — create a manual window. */
export function buildTdahDndWindowsUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DND_WINDOWS_PATH}`;
}

/** `PUT`/`DELETE /v1/tdah/dnd/windows/{id}` — edit or remove one manual window. */
export function buildTdahDndWindowUrl(cloudUrl: string, windowId: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DND_WINDOWS_PATH}/${encodeURIComponent(windowId)}`;
}

/** `PUT /v1/tdah/dnd/calendar` — replace the detected windows of a range in block. */
export function buildTdahDndCalendarUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_DND_CALENDAR_PATH}`;
}
