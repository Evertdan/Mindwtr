import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  generateUUID,
  resetHeartbeatOptOutMarker,
  sendDailyHeartbeat,
  sendHeartbeatOptOut,
  type AppSettings,
} from '@mindwtr/core';

const ANALYTICS_DISTINCT_ID_KEY = 'mindwtr-analytics-distinct-id';

type PlatformExtras = typeof Platform & {
  isPad?: boolean;
  constants?: {
    Release?: string;
  };
};

const platformExtras = Platform as PlatformExtras;

export type MobileAnalyticsHeartbeatConfig = {
  analyticsHeartbeatUrl: string;
  analyticsHeartbeatChannel?: string;
  appVersion: string;
  isExpoGo: boolean;
  isFossBuild: boolean;
};

export function isMobileAnalyticsHeartbeatConfigured({
  analyticsHeartbeatUrl,
  isExpoGo,
}: Pick<MobileAnalyticsHeartbeatConfig, 'analyticsHeartbeatUrl' | 'isExpoGo' | 'isFossBuild'>): boolean {
  return !isExpoGo && Boolean(analyticsHeartbeatUrl.trim());
}

export function resolveMobileAnalyticsVersion(
  baseVersion: string,
  releaseVersion?: string | null
): string {
  const base = String(baseVersion || '').trim() || '0.0.0';
  const release = String(releaseVersion || '').trim().replace(/^v/i, '');
  if (!release || release === base) return base;
  if (release.startsWith(`${base}-`)) return release;
  return base;
}

function canSendMobileAnalyticsHeartbeat(config: MobileAnalyticsHeartbeatConfig): boolean {
  return isMobileAnalyticsHeartbeatConfigured(config) && !__DEV__;
}

async function getMobileAnalyticsChannel(
  isFossBuild: boolean,
  configuredChannel?: string | null
): Promise<string> {
  const channel = String(configuredChannel ?? '').trim();
  if (channel) return channel;
  if (Platform.OS === 'ios') return 'app-store';
  if (Platform.OS !== 'android') return Platform.OS || 'mobile';
  // Los lanzamientos incorporan ANALYTICS_HEARTBEAT_CHANNEL (play-store, android-internal-test,
  // android-direct), so this fallback only fires for builds without one. The old
  // install-referrer probe is gone: testing-track installs carry no referrer and the
  // API can reject, which misfiled Play testers as android-sideload/android-unknown.
  return isFossBuild ? 'fdroid' : 'play-store';
}

async function getOrCreateAnalyticsDistinctId(): Promise<string> {
  const existing = (await AsyncStorage.getItem(ANALYTICS_DISTINCT_ID_KEY) || '').trim();
  if (existing) return existing;
  const generated = generateUUID();
  await AsyncStorage.setItem(ANALYTICS_DISTINCT_ID_KEY, generated);
  return generated;
}

function getMobileDeviceClass(): string {
  if (Platform.OS === 'ios') return platformExtras.isPad === true ? 'tablet' : 'phone';
  if (Platform.OS === 'android') return 'phone';
  return 'desktop';
}

function getMobileOsMajor(): string {
  if (Platform.OS === 'ios') {
    const raw = String(Platform.Version ?? '');
    const major = raw.match(/\d+/)?.[0];
    return major ? `ios-${major}` : 'ios';
  }
  if (Platform.OS === 'android') {
    const raw = String(platformExtras.constants?.Release ?? Platform.Version ?? '');
    const major = raw.match(/\d+/)?.[0];
    return major ? `android-${major}` : 'android';
  }
  return Platform.OS || 'mobile';
}

export function getDeviceLocale(): string {
  try {
    return String(Intl.DateTimeFormat().resolvedOptions().locale || '').trim();
  } catch {
    return '';
  }
}

export async function getMobileStartupAnalyticsContext(
  isFossBuild: boolean,
  analyticsHeartbeatChannel?: string | null
) {
  return {
    channel: await getMobileAnalyticsChannel(isFossBuild, analyticsHeartbeatChannel).catch(() => Platform.OS || 'mobile'),
    deviceClass: getMobileDeviceClass(),
    locale: getDeviceLocale(),
    osMajor: getMobileOsMajor(),
    platform: Platform.OS,
  };
}

async function buildMobileHeartbeatOptions(config: MobileAnalyticsHeartbeatConfig) {
  const [distinctId, channel] = await Promise.all([
    getOrCreateAnalyticsDistinctId(),
    getMobileAnalyticsChannel(config.isFossBuild, config.analyticsHeartbeatChannel),
  ]);
  return {
    enabled: true,
    endpointUrl: config.analyticsHeartbeatUrl,
    distinctId,
    platform: Platform.OS,
    channel,
    appVersion: config.appVersion,
    deviceClass: getMobileDeviceClass(),
    osMajor: getMobileOsMajor(),
    locale: getDeviceLocale(),
    storage: AsyncStorage,
    fetcher: fetch,
  };
}

export async function sendMobileAnalyticsOptOut(config: MobileAnalyticsHeartbeatConfig): Promise<boolean> {
  if (!canSendMobileAnalyticsHeartbeat(config)) return false;
  return sendHeartbeatOptOut(await buildMobileHeartbeatOptions(config));
}

export async function resetMobileAnalyticsOptOutMarker(): Promise<void> {
  await resetHeartbeatOptOutMarker(AsyncStorage);
}

export async function sendMobileDailyHeartbeat(
  config: MobileAnalyticsHeartbeatConfig,
  settings: AppSettings
): Promise<boolean> {
  if (!canSendMobileAnalyticsHeartbeat(config)) return false;
  if (settings.analytics?.heartbeatEnabled === false) {
    return false;
  }
  return sendDailyHeartbeat(await buildMobileHeartbeatOptions(config));
}
