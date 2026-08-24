import type { ConfigContext, ExpoConfig } from 'expo/config';
import { readFileSync } from 'fs';
import { join } from 'path';

const isFossBuild = process.env.FOSS_BUILD === '1' || process.env.FOSS_BUILD === 'true';
const analyticsHeartbeatDisabled = process.env.ANALYTICS_HEARTBEAT_DISABLED === '1'
  || process.env.ANALYTICS_HEARTBEAT_DISABLED === 'true';
const configuredAnalyticsHeartbeatUrl = (process.env.ANALYTICS_HEARTBEAT_URL ?? '').trim();
// Por defecto comprometido para que las compilaciones de origen (compilaciones reproducibles de F-Droid, IzzyOnDroid)
// send the anonymous opt-out heartbeat too — a CI secret cannot reach those builds, and
// baking it from source keeps the FOSS APK byte-identical across rebuilds. Dev builds
// and Expo Go never send regardless of this value.
const DEFAULT_ANALYTICS_HEARTBEAT_URL = 'https://mindwtr-analytics.mindwtr.workers.dev/';
const analyticsHeartbeatUrl = analyticsHeartbeatDisabled
  ? ''
  : (configuredAnalyticsHeartbeatUrl || DEFAULT_ANALYTICS_HEARTBEAT_URL);
const analyticsHeartbeatChannel = (
  process.env.ANALYTICS_HEARTBEAT_CHANNEL
    ?? (isFossBuild && analyticsHeartbeatUrl ? 'fdroid' : '')
).trim();
// Comprometido por scripts/bump-version.sh para compilaciones reproducibles libres de env (F-Droid,
// IzzyOnDroid) still report the full release version including any -rc.N suffix.
const committedReleaseVersion = (() => {
  try {
    const parsed = JSON.parse(readFileSync(join(__dirname, 'release-version.json'), 'utf8'));
    return String(parsed.releaseVersion ?? '').trim();
  } catch {
    return '';
  }
})();
const analyticsReleaseVersion = (process.env.ANALYTICS_RELEASE_VERSION ?? '').trim() || committedReleaseVersion;
const feedbackEndpointUrl = (process.env.FEEDBACK_ENDPOINT_URL ?? '').trim();
const dropboxAppKey = (process.env.DROPBOX_APP_KEY ?? '').trim();
const donationPromptEnabled = process.env.DONATION_PROMPT_ENABLED === '1'
  || process.env.DONATION_PROMPT_ENABLED === 'true';
const promptTestControlsEnabled = process.env.PROMPT_TEST_CONTROLS_ENABLED === '1'
  || process.env.PROMPT_TEST_CONTROLS_ENABLED === 'true';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const extra = {
    ...(base.extra ?? {}),
    isFossBuild,
    analyticsHeartbeatUrl,
    analyticsHeartbeatChannel,
    analyticsReleaseVersion,
    feedbackEndpointUrl,
    dropboxAppKey,
    donationPromptEnabled,
    promptTestControlsEnabled,
  };

  return {
    ...base,
    extra,
  };
};
