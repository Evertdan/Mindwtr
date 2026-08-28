import {
  areDueDateRemindersEnabled,
  areStartDateRemindersEnabled,
  areTaskRemindersEnabled,
  buildReminderSchedule,
  getSystemDefaultLanguage,
  getTranslations,
  hasActiveMobileNotificationFeature,
  isWeeklyReviewReminderEnabled,
  loadStoredLanguage,
  nameNotifyListener,
  type Language,
  type ReminderScheduleRequest,
  useTaskStore,
} from '@mindwtr/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';

import { isLoggingEnabled, logInfo, logWarn } from './app-log';
import { ensureReminderNotificationChannel, restorePersistentCaptureNotification } from '@/modules/notification-open-intents';
import { getDuplicateAlarmRetryFireAt } from './notification-service-local-utils';

type NotificationOpenPayload = {
  notificationId?: string;
  actionIdentifier?: string;
  taskId?: string;
  projectId?: string;
  context?: string;
  kind?: string;
  /** Story 2.2: 'start' | 'end' on a `kind: 'tdah-activity'` payload — see use-root-layout-tdah-connection.ts's handleTdahActivityTriggerEvent. */
  edge?: string;
};

type NotificationOpenHandler = (payload: NotificationOpenPayload) => void;

type NotificationPermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
};

type AlarmId = number;

type AlarmScheduleResult = {
  id?: number | string;
};

type AlarmNotificationsApi = {
  parseDate: (date: Date) => string;
  scheduleAlarm: (details: Record<string, unknown>) => Promise<AlarmScheduleResult>;
  sendNotification?: (details: Record<string, unknown>) => void;
  deleteAlarm: (id: AlarmId) => void;
  deleteRepeatingAlarm: (id: AlarmId) => void;
  removeFiredNotification: (id: AlarmId) => void;
  removeAllFiredNotifications: () => void;
  getScheduledAlarms?: () => Promise<unknown>;
  requestPermissions?: (permissions: { alert: boolean; badge: boolean; sound: boolean }) => Promise<unknown>;
};

type LocalAlarmMapEntry = {
  id: AlarmId;
  signature?: string;
};

type PomodoroAlarmEntry = {
  id: AlarmId;
  fireAtMs?: number;
};

type LocalAlarmMap = Record<string, LocalAlarmMapEntry>;

type LocalAlarmConfig = {
  title: string;
  message: string;
  fireAt: Date;
  repeatInterval?: 'daily' | 'weekly';
  hasSnoozeAction?: boolean;
  hasCompleteAction?: boolean;
  data?: Record<string, string>;
  /**
   * Story 2.2 additions — all optional and unused by the GTD/pomodoro call
   * sites above, so their behavior (channel `LOCAL_NOTIFICATION_CHANNEL`,
   * `vibrate: false`, `TASK_REMINDER_SNOOZE_MINUTES`, hardcoded native
   * action labels) stays byte-identical when omitted.
   */
  channel?: string;
  vibrate?: boolean;
  /** `[delay, on, off, on, ...]` ms, forwarded to the native layer verbatim — see tdah-activity-notification.ts. */
  vibrationPattern?: number[];
  /** Adds a third real "Iniciar" action button (patch-alarm-notification-gradle.js's `notificationActionStart`) and, per spec, suppresses the native DISMISS button so the TDAH Activity notification shows exactly 3 actions. */
  hasStartAction?: boolean;
  /** Own module constant (spec Never: "no reutilizar TASK_REMINDER_SNOOZE_MINUTES del pipeline GTD... declarar una constante propia"); defaults to the GTD constant when omitted. */
  snoozeMinutes?: number;
  actionLabels?: {
    start?: string;
    complete?: string;
    snooze?: string;
  };
  /** Localized Android notification-channel display name — same pass-through-via-bundle pattern as `actionLabels` (patch-alarm-notification-gradle.js reads `tdahActivityNotificationChannelName` off the data bundle, falling back to its own hardcoded string when absent). */
  channelDisplayName?: string;
};

type NativeEmitterSubscription = {
  remove: () => void;
};

const LOCAL_ALARM_MAP_KEY = 'mindwtr:local:alarms:v1';
const LOCAL_POMODORO_ALARM_KEY = 'mindwtr:local:pomodoro-alarm:v1';
const LOCAL_NOTIFICATION_CHANNEL = 'mindwtr_reminders_v2';
const LOCAL_NOTIFICATION_CHANNEL_NAME = 'Mindwtr reminders';
const LOCAL_NOTIFICATION_COLOR = '#3b82f6';
const LOCAL_SMALL_ICON = 'ic_launcher';
const MAX_DUPLICATE_ALARM_RETRIES = 59;
const MAX_PENDING_ONE_SHOT_REMINDER_ALARMS_IOS = 60;
const MAX_PENDING_ONE_SHOT_REMINDER_ALARMS_ANDROID = 200;
const ALARM_SCHEDULE_BATCH_SIZE = 10;
const ONE_SHOT_TOP_UP_DELAY_MS = 5_000;
const MAX_SETTIMEOUT_DELAY_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_EVENT_RESCHEDULE_DEBOUNCE_MS = 250;
// A sync cycle updates the store several times within a few seconds
// (write-local, write-remote bookkeeping, refresh); coalesce those into one
// full reschedule scan instead of 2-4 per cycle (#766). Alarms fire minutes
// out, so a short scheduling delay is imperceptible.
const STORE_RESCHEDULE_DEBOUNCE_MS = 2_500;
const TASK_REMINDER_SNOOZE_MINUTES = 10;

// Story 2.2 ("La vibra en la muñeca"). Own constant per spec's Never bullet:
// never reuse TASK_REMINDER_SNOOZE_MINUTES above, even though the value
// happens to match today (ADR-0013: no shared scheduling constants with the
// GTD pipeline).
export const TDAH_ACTIVITY_SNOOZE_MINUTES = 10;
// Must match TDAH_ACTIVITY_NOTIFICATION_CHANNEL_ID in
// apps/mobile/plugins/patch-alarm-notification-gradle.js — the native patch
// special-cases this exact channel id for IMPORTANCE_HIGH + vibration
// (distinct from LOCAL_NOTIFICATION_CHANNEL above, which N-... GTD reminders
// use at IMPORTANCE_DEFAULT with no vibration). Keep both literals in sync.
export const TDAH_ACTIVITY_NOTIFICATION_CHANNEL = 'mindwtr_tdah_activity_v1';

let started = false;
let alarmApi: AlarmNotificationsApi | null = null;
let notificationOpenHandler: NotificationOpenHandler | null = null;
let storeSubscription: (() => void) | null = null;
let openSubscription: NativeEmitterSubscription | null = null;
let dismissSubscription: NativeEmitterSubscription | null = null;
let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
let oneShotTopUpTimer: ReturnType<typeof setTimeout> | null = null;
let notificationEventRescheduleTimer: ReturnType<typeof setTimeout> | null = null;
let rescheduleQueue: Promise<void> = Promise.resolve();
let alarmMap = new Map<string, LocalAlarmMapEntry>();
let loadedAlarmMap = false;
let alarmMapLoadPromise: Promise<void> | null = null;
// Last payload `saveAlarmMap` actually wrote; null means "unknown, write it".
let lastSavedAlarmMapJson: string | null = null;
const configByKey = new Map<string, string>();

type AlarmScheduleRequest = {
  key: string;
  config: LocalAlarmConfig;
};

const logNotificationError = (message: string, error?: unknown) => {
  const extra = error ? { error: error instanceof Error ? error.message : String(error) } : undefined;
  void logWarn(`[Local Notifications] ${message}`, { scope: 'notifications', extra });
};

const logNotificationInfo = (message: string, extra?: Record<string, unknown>) => {
  void logInfo(`[Local Notifications] ${message}`, { scope: 'notifications', extra });
};

const logNotificationWarn = (message: string, extra?: Record<string, unknown>) => {
  void logWarn(`[Local Notifications] ${message}`, { scope: 'notifications', extra });
};

async function loadPomodoroAlarmEntry(): Promise<PomodoroAlarmEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_POMODORO_ALARM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PomodoroAlarmEntry>;
    const id = Number(parsed?.id);
    if (!Number.isFinite(id)) return null;
    const fireAtMs = Number(parsed?.fireAtMs);
    return {
      id: Math.floor(id),
      ...(Number.isFinite(fireAtMs) ? { fireAtMs } : {}),
    };
  } catch (error) {
    logNotificationError('Failed to load pomodoro alarm', error);
    return null;
  }
}

async function savePomodoroAlarmEntry(entry: PomodoroAlarmEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_POMODORO_ALARM_KEY, JSON.stringify(entry));
  } catch (error) {
    logNotificationError('Failed to persist pomodoro alarm', error);
  }
}

async function clearPomodoroAlarmEntry(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCAL_POMODORO_ALARM_KEY);
  } catch (error) {
    logNotificationError('Failed to clear pomodoro alarm', error);
  }
}

function resetRuntimeState(): void {
  configByKey.clear();
  lastSavedAlarmMapJson = null;
  rescheduleQueue = Promise.resolve();
  notificationOpenHandler = null;
  alarmMapLoadPromise = null;
  clearOneShotTopUpTimer();
  clearNotificationEventRescheduleTimer();
}

function clearRescheduleTimer(): void {
  if (!rescheduleTimer) return;
  clearTimeout(rescheduleTimer);
  rescheduleTimer = null;
}

function clearOneShotTopUpTimer(): void {
  if (!oneShotTopUpTimer) return;
  clearTimeout(oneShotTopUpTimer);
  oneShotTopUpTimer = null;
}

function clearNotificationEventRescheduleTimer(): void {
  if (!notificationEventRescheduleTimer) return;
  clearTimeout(notificationEventRescheduleTimer);
  notificationEventRescheduleTimer = null;
}

function getMaxPendingOneShotReminderAlarms(): number {
  return Platform.OS === 'ios'
    ? MAX_PENDING_ONE_SHOT_REMINDER_ALARMS_IOS
    : MAX_PENDING_ONE_SHOT_REMINDER_ALARMS_ANDROID;
}

async function getAndroidNotificationPermissionStatus(): Promise<NotificationPermissionResult> {
  if (Number(Platform.Version) < 33) {
    return { granted: true, canAskAgain: true };
  }

  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return { granted, canAskAgain: !granted };
  } catch (error) {
    logNotificationError('Failed to read Android notification permission', error);
    return { granted: false, canAskAgain: false };
  }
}

async function ensureLocalReminderNotificationChannel(): Promise<void> {
  try {
    await ensureReminderNotificationChannel(LOCAL_NOTIFICATION_CHANNEL, LOCAL_NOTIFICATION_CHANNEL_NAME);
    logNotificationInfo('Android reminder notification channel ensured', {
      channel: LOCAL_NOTIFICATION_CHANNEL,
    });
  } catch (error) {
    logNotificationError('Failed to ensure local notification channel', error);
  }
}

async function loadAlarmApi(): Promise<AlarmNotificationsApi | null> {
  if (alarmApi) return alarmApi;
  try {
    const mod = await import('react-native-alarm-notification');
    const api = mod?.default as AlarmNotificationsApi | undefined;
    if (!api || typeof api.scheduleAlarm !== 'function') {
      logNotificationError('react-native-alarm-notification API unavailable');
      return null;
    }
    alarmApi = api;
    return api;
  } catch (error) {
    logNotificationError('Failed to load react-native-alarm-notification', error);
    return null;
  }
}

async function clearScheduledAlarms(api: AlarmNotificationsApi | null): Promise<void> {
  await loadAlarmMapIfNeeded();
  await cancelLocalPomodoroCompletionNotification(api, { removeFired: true, reason: 'service-clear' });
  const scheduledAlarmCount = alarmMap.size;

  if (api) {
    for (const entry of alarmMap.values()) {
      try {
        api.deleteAlarm(entry.id);
        api.deleteRepeatingAlarm(entry.id);
        api.removeFiredNotification(entry.id);
      } catch (error) {
        logNotificationError('Failed to cancel local alarm', error);
      }
    }

    try {
      api.removeAllFiredNotifications();
    } catch {
      // no-op
    }

    // removeAllFiredNotifications() is NotificationManager.cancelAll(): it also
    // wipes the pinned quick-capture notification, which is why the Maneja
    // vanished whenever reminders were off (#819). Re-assert it from its
    // native mirror; a no-op when the capture toggle is off.
    try {
      restorePersistentCaptureNotification();
    } catch {
      // no-op
    }
  }

  alarmMap.clear();
  await saveAlarmMap();
  loadedAlarmMap = false;
  logNotificationInfo('Scheduled alarms cleared', { scheduledAlarmCount });
}

function serializeAlarmMap(map: Map<string, LocalAlarmMapEntry>): LocalAlarmMap {
  const result: LocalAlarmMap = {};
  for (const [key, value] of map.entries()) {
    result[key] = value;
  }
  return result;
}

async function loadAlarmMapIfNeeded(): Promise<void> {
  if (loadedAlarmMap) return;
  if (alarmMapLoadPromise) {
    await alarmMapLoadPromise;
    return;
  }
  alarmMapLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(LOCAL_ALARM_MAP_KEY);
      if (!raw) {
        alarmMap = new Map<string, LocalAlarmMapEntry>();
        loadedAlarmMap = true;
        return;
      }
      const parsed = JSON.parse(raw) as LocalAlarmMap;
      const nextMap = new Map<string, LocalAlarmMapEntry>();
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        const id = Number((value as LocalAlarmMapEntry).id);
        if (!Number.isFinite(id)) continue;
        const signature = typeof (value as LocalAlarmMapEntry).signature === 'string'
          ? (value as LocalAlarmMapEntry).signature
          : undefined;
        nextMap.set(key, { id: Math.floor(id), signature });
        if (signature) {
          configByKey.set(key, signature);
        }
      }
      alarmMap = nextMap;
      loadedAlarmMap = true;
    } catch (error) {
      alarmMap = new Map<string, LocalAlarmMapEntry>();
      loadedAlarmMap = false;
      logNotificationError('Failed to load alarm map', error);
    }
  })().finally(() => {
    alarmMapLoadPromise = null;
  });
  await alarmMapLoadPromise;
}

async function saveAlarmMap(): Promise<void> {
  // Every reschedule cycle ends here, but a cycle that re-derives the same
  // alarms leaves the Mapea byte-identical — the common case, since most saves
  // touch no reminder-relevant field. Comparing the serialized form catches
  // that regardless of which path mutated the Mapea (schedule, cancel, clear),
  // so a no-op cycle costs no AsyncStorage write (#766).
  const serialized = JSON.stringify(serializeAlarmMap(alarmMap));
  if (serialized === lastSavedAlarmMapJson) return;
  try {
    await AsyncStorage.setItem(LOCAL_ALARM_MAP_KEY, serialized);
    lastSavedAlarmMapJson = serialized;
  } catch (error) {
    lastSavedAlarmMapJson = null;
    logNotificationError('Failed to persist alarm map', error);
  }
}

function toAlarmFireDate(api: AlarmNotificationsApi, date: Date): string {
  const next = new Date(date);
  next.setMilliseconds(0);
  return api.parseDate(next);
}

function isDuplicateAlarmError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('duplicate alarm set at date');
}

function parseEventPayload(value: unknown): Record<string, string> | null {
  const raw = typeof value === 'string' ? value : null;
  try {
    const parsed = raw ? JSON.parse(raw) as unknown : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === 'data') {
        const nested = parseEventPayload(item);
        if (nested) {
          for (const [nestedKey, nestedValue] of Object.entries(nested)) {
            result[nestedKey] ??= nestedValue;
          }
        }
      } else if (typeof item === 'string') {
        result[key] = item;
      } else if (item !== undefined && item !== null) {
        result[key] = String(item);
      }
    }
    return result;
  } catch {
    return null;
  }
}

function attachNativeEventListeners(): void {
  const nativeModule = (NativeModules as Record<string, unknown>).RNAlarmNotification;
  if (!nativeModule) return;

  const emitter = new NativeEventEmitter(nativeModule as any);

  openSubscription?.remove();
  openSubscription = emitter.addListener('OnNotificationOpened', (payload: unknown) => {
    const data = parseEventPayload(payload);
    if (!data) {
      logNotificationWarn('Notification event payload was unreadable');
      return;
    }
    // Receipt evidence for #1028: every tap that reaches JS is logged, so a
    // dead action button with no line here means the tap died in the native
    // layer (receiver never ran, or the alarm row it looks up is gone).
    logNotificationInfo('Notification opened event', {
      action: data.actionIdentifier || 'open',
      alarmKey: data.alarmKey || data.id || '',
      taskId: data.taskId || '',
      handlerAttached: String(Boolean(notificationOpenHandler)),
    });
    if (data.kind === 'pomodoro') {
      // Presentation evidence for #888: a tap proves iOS actually showed it.
      logNotificationInfo('Pomodoro notification opened', { id: data.alarmKey || data.id || '' });
    }
    if (alarmApi && (data.taskId || data.projectId)) {
      enqueueNotificationEventReschedule(alarmApi);
    }
    if (!notificationOpenHandler) return;
    try {
      notificationOpenHandler({
        notificationId: data.alarmKey || data.id,
        actionIdentifier: data.actionIdentifier || 'open',
        taskId: data.taskId,
        projectId: data.projectId,
        context: data.context,
        kind: data.kind,
        edge: data.edge,
      });
    } catch (error) {
      logNotificationError('Failed to handle notification open event', error);
    }
  });

  dismissSubscription?.remove();
  dismissSubscription = emitter.addListener('OnNotificationDismissed', (payload: unknown) => {
    const data = parseEventPayload(payload);
    logNotificationInfo('Notification dismissed event', {
      alarmKey: data?.alarmKey || data?.id || '',
      taskId: data?.taskId || '',
    });
    if (data?.kind === 'pomodoro') {
      logNotificationInfo('Pomodoro notification dismissed', { id: data.alarmKey || data.id || '' });
    }
    if (alarmApi && data && (data.taskId || data.projectId)) {
      enqueueNotificationEventReschedule(alarmApi);
    }
  });
}

function buildAlarmConfigSignature(config: LocalAlarmConfig): string {
  const repeatSchedule = (() => {
    if (!config.repeatInterval) return config.fireAt.toISOString();
    const hours = String(config.fireAt.getHours()).padStart(2, '0');
    const minutes = String(config.fireAt.getMinutes()).padStart(2, '0');
    if (config.repeatInterval === 'weekly') {
      return `${config.repeatInterval}:${config.fireAt.getDay()}:${hours}:${minutes}`;
    }
    return `${config.repeatInterval}:${hours}:${minutes}`;
  })();
  return JSON.stringify({
    title: config.title,
    message: config.message,
    fireAt: repeatSchedule,
    repeatInterval: config.repeatInterval ?? 'once',
    hasSnoozeAction: config.hasSnoozeAction === true,
    ...(config.hasCompleteAction === true ? { hasCompleteAction: true } : {}),
    ...(config.hasStartAction === true ? { hasStartAction: true } : {}),
    ...(config.channel ? { channel: config.channel } : {}),
    ...(config.vibrate === true ? { vibrate: true } : {}),
    ...(config.vibrationPattern?.length ? { vibrationPattern: config.vibrationPattern } : {}),
    ...(config.snoozeMinutes !== undefined ? { snoozeMinutes: config.snoozeMinutes } : {}),
    ...(config.actionLabels ? { actionLabels: config.actionLabels } : {}),
    ...(config.channelDisplayName ? { channelDisplayName: config.channelDisplayName } : {}),
    data: config.data ?? {},
  });
}

function normalizeNotificationMessage(title: string, message?: string): string {
  const trimmedMessage = String(message || '').trim();
  if (trimmedMessage) return trimmedMessage;

  return String(title || '').trim();
}

async function cancelAlarmByKey(api: AlarmNotificationsApi, key: string): Promise<boolean> {
  const entry = alarmMap.get(key);
  if (!entry) return false;
  try {
    api.deleteAlarm(entry.id);
  } catch (error) {
    logNotificationError(`Failed to delete alarm (${key})`, error);
  }
  try {
    api.deleteRepeatingAlarm(entry.id);
  } catch {
    // Safe to ignore when alarm is one-shot.
  }
  try {
    api.removeFiredNotification(entry.id);
  } catch {
    // Safe to ignore if notification has not fired.
  }
  alarmMap.delete(key);
  configByKey.delete(key);
  logNotificationInfo('Alarm canceled', { alarmKey: key, alarmId: entry.id });
  return true;
}

async function scheduleAlarmForKey(api: AlarmNotificationsApi, key: string, config: LocalAlarmConfig): Promise<void> {
  const signature = buildAlarmConfigSignature(config);
  const existingAlarm = alarmMap.get(key);
  const existingSignature = configByKey.get(key) ?? existingAlarm?.signature;
  if (existingAlarm && existingSignature === signature) {
    configByKey.set(key, signature);
    return;
  }

  await cancelAlarmByKey(api, key);

  const baseFireAt = new Date(config.fireAt);
  baseFireAt.setMilliseconds(0);

  const detailsBase: Record<string, unknown> = {
    title: config.title,
    message: normalizeNotificationMessage(config.title, config.message),
    channel: config.channel ?? LOCAL_NOTIFICATION_CHANNEL,
    auto_cancel: true,
    small_icon: LOCAL_SMALL_ICON,
    color: LOCAL_NOTIFICATION_COLOR,
    has_button: config.hasSnoozeAction === true || config.hasCompleteAction === true || config.hasStartAction === true,
    has_complete_action: config.hasCompleteAction === true,
    loop_sound: false,
    play_sound: true,
    schedule_type: config.repeatInterval ? 'repeat' : 'once',
    repeat_interval: config.repeatInterval ?? 'hourly',
    interval_value: 1,
    use_big_text: true,
    vibrate: config.vibrate === true,
    data: {
      ...(config.data ?? {}),
      alarmKey: key,
      ...(config.hasCompleteAction === true ? { notificationActionComplete: 'true' } : {}),
      ...(config.hasStartAction === true ? { notificationActionStart: 'true' } : {}),
      ...(config.vibrationPattern?.length ? { vibrationPattern: config.vibrationPattern.join(',') } : {}),
      ...(config.actionLabels?.start ? { tdahStartActionLabel: config.actionLabels.start } : {}),
      ...(config.actionLabels?.complete ? { tdahCompleteActionLabel: config.actionLabels.complete } : {}),
      ...(config.actionLabels?.snooze ? { tdahSnoozeActionLabel: config.actionLabels.snooze } : {}),
      ...(config.channelDisplayName ? { tdahActivityNotificationChannelName: config.channelDisplayName } : {}),
    },
    ...(config.hasSnoozeAction === true ? { snooze_interval: config.snoozeMinutes ?? TASK_REMINDER_SNOOZE_MINUTES } : {}),
  };

  let scheduledId: number | null = null;
  let lastError: unknown = null;

  for (let retry = 0; retry <= MAX_DUPLICATE_ALARM_RETRIES; retry += 1) {
    // El/La
    const fireAt = getDuplicateAlarmRetryFireAt(baseFireAt, retry);
    try {
      const result = await api.scheduleAlarm({
        ...detailsBase,
        fire_date: toAlarmFireDate(api, fireAt),
      });
      const id = Number(result?.id);
      if (!Number.isFinite(id)) {
        logNotificationError(`Scheduled alarm returned invalid id for ${key}`);
        return;
      }
      scheduledId = Math.floor(id);
      logNotificationInfo('Alarm scheduled', {
        alarmKey: key,
        alarmId: scheduledId,
        fireAt: fireAt.toISOString(),
        retryCount: retry,
        scheduleType: config.repeatInterval ? 'repeat' : 'once',
      });
      break;
    } catch (error) {
      lastError = error;
      if (isDuplicateAlarmError(error) && retry < MAX_DUPLICATE_ALARM_RETRIES) {
        continue;
      }
      logNotificationError(`Failed to schedule alarm (${key})`, error);
      throw error;
    }
  }

  if (scheduledId === null) {
    logNotificationError(`Failed to schedule alarm for ${key} after duplicate retries`, lastError);
    return;
  }

  alarmMap.set(key, { id: scheduledId, signature });
  configByKey.set(key, signature);
}

async function scheduleAlarmRequests(api: AlarmNotificationsApi, requests: AlarmScheduleRequest[]): Promise<void> {
  for (let index = 0; index < requests.length; index += ALARM_SCHEDULE_BATCH_SIZE) {
    const batch = requests.slice(index, index + ALARM_SCHEDULE_BATCH_SIZE);
    await Promise.all(batch.map((request) => scheduleAlarmForKey(api, request.key, request.config)));
  }
}

// Pending requests the OS actually holds, for the cycle-complete Registro only —
// never Se usa para drive cancellation. A count above `alarmMap.Tamaño` is the
// signature of #1020 (a cancel that silently removed nothing), and it is the
// one number that separates "still leaking" from "orphans from before the fix
// firing one last time" without another week of counting notifications by
// hand. Devuelve null when the module cannot enumerate.
//
// Diagnostics-only, so it is gated on logging: the enumeration is a native
// round-trip that a reschedule cycle otherwise pays on every store change even
// though nothing reads the result with logging off (#766).
async function countPendingNativeAlarms(api: AlarmNotificationsApi): Promise<number | null> {
  if (!isLoggingEnabled()) return null;
  if (typeof api.getScheduledAlarms !== 'function') return null;
  try {
    const pending = await api.getScheduledAlarms();
    return Array.isArray(pending) ? pending.length : null;
  } catch (error) {
    logNotificationError('Failed to read pending native alarms', error);
    return null;
  }
}

async function cancelInactiveKeys(api: AlarmNotificationsApi, activeKeys: Set<string>): Promise<void> {
  for (const key of Array.from(alarmMap.keys())) {
    if (activeKeys.has(key)) continue;
    await cancelAlarmByKey(api, key);
  }
}

function scheduleOneShotTopUp(api: AlarmNotificationsApi, sortedFireAtMs: number[], nowMs: number): void {
  clearOneShotTopUpTimer();
  if (sortedFireAtMs.length === 0) return;

  const nextFireAtMs = sortedFireAtMs[0];
  if (!Number.isFinite(nextFireAtMs)) return;

  const rawDelayMs = Math.max(ONE_SHOT_TOP_UP_DELAY_MS, nextFireAtMs - nowMs + ONE_SHOT_TOP_UP_DELAY_MS);
  const delayMs = Math.min(MAX_SETTIMEOUT_DELAY_MS, rawDelayMs);
  oneShotTopUpTimer = setTimeout(() => {
    oneShotTopUpTimer = null;
    enqueueReschedule(api);
  }, delayMs);
}

function toLocalAlarmConfig(request: ReminderScheduleRequest): LocalAlarmConfig {
  return {
    title: request.title,
    message: request.message,
    fireAt: request.fireAt,
    repeatInterval: request.repeatInterval,
    hasSnoozeAction: request.hasSnoozeAction,
    hasCompleteAction: request.hasCompleteAction,
    data: request.data,
  };
}

async function runRescheduleCycle(api: AlarmNotificationsApi): Promise<void> {
  const cycleStartedAtMs = Date.now();
  await loadAlarmMapIfNeeded();

  const { settings, tasks, projects } = useTaskStore.getState();
  const activeKeys = new Set<string>();
  const taskRemindersEnabled = areTaskRemindersEnabled(settings);
  const includeStartTime = areStartDateRemindersEnabled(settings);
  const includeDueDate = areDueDateRemindersEnabled(settings);
  const weeklyReviewEnabled = isWeeklyReviewReminderEnabled(settings);
  const activeFeature = hasActiveMobileNotificationFeature(settings);

  logNotificationInfo('Reschedule cycle started', {
    taskCount: tasks.length,
    projectCount: projects.length,
    existingAlarmCount: alarmMap.size,
    activeFeature,
    taskRemindersEnabled,
    includeStartTime,
    includeDueDate,
    includeReviewAt: taskRemindersEnabled && settings.reviewAtNotificationsEnabled !== false,
    weeklyReviewEnabled,
  });

  if (!activeFeature) {
    clearOneShotTopUpTimer();
    for (const key of Array.from(alarmMap.keys())) {
      await cancelAlarmByKey(api, key);
    }
    await saveAlarmMap();
    logNotificationInfo('Reschedule cycle complete', {
      activeFeature,
      scheduledAlarmCount: alarmMap.size,
      oneShotReminderCount: 0,
      scheduledOneShotReminderCount: 0,
      durationMs: Date.now() - cycleStartedAtMs,
    });
    return;
  }

  const language: Language = await loadStoredLanguage(AsyncStorage, getSystemDefaultLanguage()).catch(() => getSystemDefaultLanguage());
  const tr = await getTranslations(language);
  const now = new Date();

  // Derivation lives in core (`buildReminderSchedule`): digests, weekly review, every task's
  // next reminder plus its due-time repeats, and project reviews, already sorted and capped.
  // Este/Esta
  const { requests, diagnostics } = buildReminderSchedule({
    settings,
    tasks,
    projects,
    now,
    translations: tr,
    maxOneShotReminders: getMaxPendingOneShotReminderAlarms(),
  });

  const recurringRequests = requests.filter((request) => request.repeatInterval);
  const oneShotRequests = requests.filter((request) => !request.repeatInterval);

  for (const request of recurringRequests) {
    activeKeys.add(request.key);
    await scheduleAlarmForKey(api, request.key, toLocalAlarmConfig(request));
  }

  for (const request of oneShotRequests) {
    activeKeys.add(request.key);
  }
  await scheduleAlarmRequests(api, oneShotRequests.map((request) => ({
    key: request.key,
    config: toLocalAlarmConfig(request),
  })));
  scheduleOneShotTopUp(api, oneShotRequests.map((request) => request.fireAt.getTime()), now.getTime());

  await cancelInactiveKeys(api, activeKeys);
  await saveAlarmMap();
  logNotificationInfo('Reschedule cycle complete', {
    activeFeature,
    scheduledAlarmCount: alarmMap.size,
    pendingNativeAlarmCount: await countPendingNativeAlarms(api),
    oneShotReminderCount: diagnostics.oneShotReminderCount,
    scheduledOneShotReminderCount: oneShotRequests.length,
    maxPendingOneShotReminderAlarms: getMaxPendingOneShotReminderAlarms(),
    nextOneShotFireAt: oneShotRequests[0]?.fireAt.toISOString() ?? '',
    taskReminderCount: diagnostics.taskReminderCount,
    taskReviewReminderCount: diagnostics.taskReviewReminderCount,
    projectReviewReminderCount: diagnostics.projectReviewReminderCount,
    dateOnlyDueDateCount: diagnostics.dateOnlyDueDateCount,
    futureDueDateReminderCount: diagnostics.futureDueDateReminderCount,
    pastDueDateReminderCount: diagnostics.pastDueDateReminderCount,
    dateOnlyStartTimeCount: diagnostics.dateOnlyStartTimeCount,
    futureStartTimeReminderCount: diagnostics.futureStartTimeReminderCount,
    pastStartTimeReminderCount: diagnostics.pastStartTimeReminderCount,
    futureTaskReviewReminderCount: diagnostics.futureTaskReviewReminderCount,
    pastTaskReviewReminderCount: diagnostics.pastTaskReviewReminderCount,
    suppressedTaskReminderCount: diagnostics.suppressedTaskReminderCount,
    durationMs: Date.now() - cycleStartedAtMs,
  });
}

function enqueueReschedule(api: AlarmNotificationsApi): void {
  rescheduleQueue = rescheduleQueue
    .catch(() => undefined)
    .then(async () => {
      await runRescheduleCycle(api);
    })
    .catch((error) => logNotificationError('Failed to reschedule local notifications', error));
}

function enqueueNotificationEventReschedule(api: AlarmNotificationsApi): void {
  clearNotificationEventRescheduleTimer();
  notificationEventRescheduleTimer = setTimeout(() => {
    notificationEventRescheduleTimer = null;
    enqueueReschedule(api);
  }, NOTIFICATION_EVENT_RESCHEDULE_DEBOUNCE_MS);
}

export function setLocalNotificationOpenHandler(handler: NotificationOpenHandler | null): void {
  notificationOpenHandler = handler;
  if (handler) {
    attachNativeEventListeners();
  }
}

export async function requestLocalNotificationPermission(): Promise<NotificationPermissionResult> {
  if (Platform.OS === 'android') {
    const currentStatus = await getAndroidNotificationPermissionStatus();
    logNotificationInfo('Android notification permission checked', currentStatus);
    if (currentStatus.granted) {
      await ensureLocalReminderNotificationChannel();
      return currentStatus;
    }

    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      logNotificationInfo('Android notification permission requested', { result });
      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        await ensureLocalReminderNotificationChannel();
        return { granted: true, canAskAgain: true };
      }
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        return { granted: false, canAskAgain: false };
      }
      return { granted: false, canAskAgain: true };
    } catch (error) {
      logNotificationError('Failed to request Android notification permission', error);
      return { granted: false, canAskAgain: false };
    }
  }

  const api = await loadAlarmApi();
  if (!api || typeof api.requestPermissions !== 'function') {
    return { granted: false, canAskAgain: false };
  }

  try {
    const result = await api.requestPermissions({ alert: true, badge: true, sound: true });
    const granted = Boolean((result as { alert?: boolean } | undefined)?.alert);
    return { granted, canAskAgain: !granted };
  } catch (error) {
    logNotificationError('Failed to request iOS notification permission', error);
    return { granted: false, canAskAgain: false };
  }
}

export async function sendLocalMobileNotification(
  title: string,
  message?: string,
  data?: Record<string, string>
): Promise<void> {
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) return;

  const api = await loadAlarmApi();
  if (!api) return;

  const permission = await requestLocalNotificationPermission();
  if (!permission.granted) return;

  try {
    const details = {
      title: trimmedTitle,
      message: normalizeNotificationMessage(trimmedTitle, message),
      channel: LOCAL_NOTIFICATION_CHANNEL,
      auto_cancel: true,
      small_icon: LOCAL_SMALL_ICON,
      color: LOCAL_NOTIFICATION_COLOR,
      has_button: false,
      loop_sound: false,
      play_sound: true,
      use_big_text: true,
      vibrate: false,
      data: {
        kind: 'pomodoro',
        ...(data ?? {}),
      },
    };

    if (typeof api.sendNotification === 'function') {
      api.sendNotification(details);
      return;
    }

    await api.scheduleAlarm({
      ...details,
      fire_date: api.parseDate(new Date(Date.now() + 2000)),
      schedule_type: 'once',
    });
  } catch (error) {
    logNotificationError('Failed to send local mobile notification', error);
  }
}

export type TdahActivityNotificationRequest = {
  /** Stable per Activity+edge, e.g. `tdah-activity:{activityId}:{edge}` — reused as the alarm-map key so a duplicate WS delivery replaces rather than stacks. */
  key: string;
  title: string;
  message?: string;
  /** `[delay, on, off, on, ...]` ms — see getTdahActivityVibrationPattern in components/tdah/today/tdah-activity-notification.ts. */
  vibrationPattern: number[];
  actionLabels: { start: string; complete: string; snooze: string };
  /** Localized Android notification-channel display name (`tdahToday.activityNotificationChannelName`) — channel names are immutable after first creation, so this only actually takes effect the very first time the TDAH Activity channel gets created on a given device, same as any other Android notification channel. */
  channelName: string;
  /** Caller-built payload — always includes `kind: 'tdah-activity'` and the Activity id (carried in `context`, the one generic field the existing native→JS open-payload path already forwards end-to-end; see use-root-layout-notification-open-handler.ts). */
  data: Record<string, string>;
};

/**
 * Story 2.2 ("La vibra en la muñeca") — shows the Activity-trigger
 * notification pushed by the VPS tick over the WS channel (story 2.1): a
 * self-sufficient title, 3 real action buttons (Iniciar/Posponer/Completada,
 * via patch-alarm-notification-gradle.js's `notificationActionStart` +
 * already-existing `notificationActionComplete`/snooze), and an edge-specific
 * vibration pattern on a dedicated high-importance, vibrating channel.
 *
 * Deliberately goes through `scheduleAlarm` (a ~2s-out fire time, same
 * convention `sendLocalMobileNotification`'s own fallback already uses)
 * rather than the library's immediate `sendNotification` bridge method: that
 * method's Android side reads the vibrate flag off the wrong bundle key
 * (`loop_sound` instead of `vibrate` — an upstream copy-paste bug), while
 * `scheduleAlarm` reads it correctly and still creates a real, DB-backed
 * alarm row so Posponer's native local reschedule (no network call) works.
 */
export async function showTdahActivityNotification(request: TdahActivityNotificationRequest): Promise<void> {
  const trimmedTitle = String(request.title || '').trim();
  if (!trimmedTitle) return;

  const api = await loadAlarmApi();
  if (!api) return;

  const permission = await requestLocalNotificationPermission();
  if (!permission.granted) return;

  await loadAlarmMapIfNeeded();
  try {
    await scheduleAlarmForKey(api, request.key, {
      title: trimmedTitle,
      message: request.message ?? trimmedTitle,
      fireAt: new Date(Date.now() + 2000),
      hasSnoozeAction: true,
      hasCompleteAction: true,
      hasStartAction: true,
      channel: TDAH_ACTIVITY_NOTIFICATION_CHANNEL,
      vibrate: true,
      vibrationPattern: request.vibrationPattern,
      snoozeMinutes: TDAH_ACTIVITY_SNOOZE_MINUTES,
      actionLabels: request.actionLabels,
      channelDisplayName: request.channelName,
      data: request.data,
    });
  } finally {
    await saveAlarmMap();
  }
}

export type TdahRitualNotificationRequest = {
  /** Stable, single key — the scheduler fires at most once per local calendar day per namespace (spec Always), so there is no per-instance id to key on the way tdah-activity's `{activityId}:{edge}` is; a duplicate WS delivery replaces rather than stacks. */
  key: string;
  title: string;
  message?: string;
  /** `[delay, on, off, on, ...]` ms — see TDAH_RITUAL_VIBRATION_PATTERN in components/tdah/today/tdah-ritual-notification.ts. */
  vibrationPattern: number[];
  /** Localized Android notification-channel display name — same pass-through as TdahActivityNotificationRequest.channelName; only takes effect the very first time the (already-existing) TDAH Activity channel gets created on a given device. */
  channelName: string;
  /** Caller-built payload — always includes `kind: 'tdah-ritual'` (see use-root-layout-notification-open-handler.ts's isTdahRitualOpen). */
  data: Record<string, string>;
};

/**
 * Story 3.1 ("La invitación nocturna") — shows N-03, the ritual-invitation
 * notification pushed by the VPS's nightly tick over the WS channel (AD-5:
 * same tick as the day close/generation). Reuses the existing
 * `TDAH_ACTIVITY_NOTIFICATION_CHANNEL` (spec Always: no new Android channel
 * — vibration is a per-notification `vibrationPattern`, not a channel
 * property) but with all three action flags off: spec Always: "solo
 * tap-to-open, sin botones", so `has_button` (computed from
 * hasSnoozeAction/hasCompleteAction/hasStartAction in scheduleAlarmForKey)
 * comes out `false` here, unlike showTdahActivityNotification's 3 real
 * actions.
 */
export async function showTdahRitualNotification(request: TdahRitualNotificationRequest): Promise<void> {
  const trimmedTitle = String(request.title || '').trim();
  if (!trimmedTitle) return;

  const api = await loadAlarmApi();
  if (!api) return;

  const permission = await requestLocalNotificationPermission();
  if (!permission.granted) return;

  await loadAlarmMapIfNeeded();
  try {
    await scheduleAlarmForKey(api, request.key, {
      title: trimmedTitle,
      message: request.message ?? trimmedTitle,
      fireAt: new Date(Date.now() + 2000),
      hasSnoozeAction: false,
      hasCompleteAction: false,
      hasStartAction: false,
      channel: TDAH_ACTIVITY_NOTIFICATION_CHANNEL,
      vibrate: true,
      vibrationPattern: request.vibrationPattern,
      channelDisplayName: request.channelName,
      data: request.data,
    });
  } finally {
    await saveAlarmMap();
  }
}

export type TdahWorkBandNotificationRequest = {
  /** Stable per band (`tdah-work-band:{activityId}`) — the server already dedupes on the band row's own `start_notified_at` (spec Always: one notification per band per local day), so this key only has to make a duplicate WS *delivery* replace rather than stack. */
  key: string;
  title: string;
  message?: string;
  /** `[delay, on, off, on, ...]` ms — see TDAH_WORK_BAND_VIBRATION_PATTERN in components/tdah/today/tdah-work-band-notification.ts. */
  vibrationPattern: number[];
  /** Localized Android notification-channel display name — same pass-through as the two requests above; only takes effect the very first time the (already-existing) TDAH Activity channel gets created on a given device. */
  channelName: string;
  /** Caller-built payload — always includes `kind: 'tdah-work-band'` and the band's Activity id in `context` (see use-root-layout-notification-open-handler.ts's isTdahWorkBandOpen). */
  data: Record<string, string>;
};

/**
 * Story 4.2 ("La franja laboral en mi día") — shows N-04, the single
 * work-band notification the VPS pushes at the band's start over the same WS
 * channel story 2.1 opened.
 *
 * Structurally identical to `showTdahRitualNotification` above, and for the
 * same two reasons: it reuses `TDAH_ACTIVITY_NOTIFICATION_CHANNEL` (spec
 * Always: "El canal Android de notificaciones no cambia" — vibration is a
 * per-notification `vibrationPattern`, not a channel property), and all
 * three action flags are `false` because the band has no Iniciar/Completada/
 * Posponer semantics: its only action is "Ver" (doc 02's N-04), which is the
 * plain body tap this dispatcher already routes. Marking the band attended
 * stays inside the app and is a local alert record — nothing here, and
 * nothing downstream of here, ever writes to Jira (FR-11).
 */
export async function showTdahWorkBandNotification(request: TdahWorkBandNotificationRequest): Promise<void> {
  const trimmedTitle = String(request.title || '').trim();
  if (!trimmedTitle) return;

  const api = await loadAlarmApi();
  if (!api) return;

  const permission = await requestLocalNotificationPermission();
  if (!permission.granted) return;

  await loadAlarmMapIfNeeded();
  try {
    await scheduleAlarmForKey(api, request.key, {
      title: trimmedTitle,
      message: request.message ?? trimmedTitle,
      fireAt: new Date(Date.now() + 2000),
      hasSnoozeAction: false,
      hasCompleteAction: false,
      hasStartAction: false,
      channel: TDAH_ACTIVITY_NOTIFICATION_CHANNEL,
      vibrate: true,
      vibrationPattern: request.vibrationPattern,
      channelDisplayName: request.channelName,
      data: request.data,
    });
  } finally {
    await saveAlarmMap();
  }
}

export async function cancelLocalPomodoroCompletionNotification(
  loadedApi?: AlarmNotificationsApi | null,
  options: { removeFired?: boolean; reason?: string } = {},
): Promise<void> {
  const api = loadedApi ?? await loadAlarmApi();
  const entry = await loadPomodoroAlarmEntry();
  if (entry) {
    // Every path that kills a pending completion alert must say so: #888's
    // empty diagnostic Registro was itself the bug report.
    logNotificationInfo('Pomodoro alarm cancelled', {
      alarmId: entry.id,
      reason: options.reason ?? 'unspecified',
      fireAt: entry.fireAtMs ? new Date(entry.fireAtMs).toISOString() : '',
      apiAvailable: String(Boolean(api)),
    });
  }
  if (api && entry) {
    try {
      api.deleteAlarm(entry.id);
      api.deleteRepeatingAlarm(entry.id);
      const shouldRemoveFired = options.removeFired ?? (!entry.fireAtMs || entry.fireAtMs > Date.now());
      if (shouldRemoveFired) {
        api.removeFiredNotification(entry.id);
      }
    } catch (error) {
      logNotificationError('Failed to cancel pomodoro alarm', error);
    }
  }
  await clearPomodoroAlarmEntry();
}

export async function scheduleLocalPomodoroCompletionNotification(
  title: string,
  message: string,
  fireAt: Date,
  data?: Record<string, string>,
): Promise<void> {
  const trimmedTitle = String(title || '').trim();
  const fireAtMs = fireAt.getTime();
  const fireAtValid = Number.isFinite(fireAtMs);

  // El/La
  // "requested" line now proves the panel never asked for an alert at all —
  // an empty Registro Se usa para be ambiguous (#888).
  logNotificationInfo('Pomodoro alarm requested', {
    fireAt: fireAtValid ? new Date(fireAtMs).toISOString() : 'invalid',
    inMs: fireAtValid ? String(fireAtMs - Date.now()) : 'invalid',
    phase: data?.phase ?? '',
    hasTitle: String(Boolean(trimmedTitle)),
  });

  if (!trimmedTitle) {
    logNotificationWarn('Pomodoro alarm skipped; empty title');
    return;
  }
  if (!fireAtValid) {
    logNotificationWarn('Pomodoro alarm skipped; invalid fire date');
    return;
  }

  const api = await loadAlarmApi();
  if (!api) {
    logNotificationWarn('Pomodoro alarm skipped; alarm module unavailable');
    return;
  }

  const permission = await requestLocalNotificationPermission();
  if (!permission.granted) {
    logNotificationWarn('Pomodoro alarm skipped; notification permission not granted');
    return;
  }

  if (fireAtMs <= Date.now() + 1000) {
    logNotificationInfo('Pomodoro completion already due; notifying immediately');
    await cancelLocalPomodoroCompletionNotification(api, { reason: 'past-due-immediate' });
    await sendLocalMobileNotification(trimmedTitle, message, data);
    return;
  }

  const previousEntry = await loadPomodoroAlarmEntry();

  try {
    const result = await api.scheduleAlarm({
      title: trimmedTitle,
      message: normalizeNotificationMessage(trimmedTitle, message),
      channel: LOCAL_NOTIFICATION_CHANNEL,
      auto_cancel: true,
      small_icon: LOCAL_SMALL_ICON,
      color: LOCAL_NOTIFICATION_COLOR,
      has_button: false,
      // El/La
      // a missing value is nil and throws NSInvalidArgumentException — the
      // reason no pomodoro alert ever scheduled on iOS (#888). Always pass it,
      // like the task-reminder path does.
      has_complete_action: false,
      loop_sound: false,
      play_sound: true,
      schedule_type: 'once',
      use_big_text: true,
      vibrate: false,
      fire_date: toAlarmFireDate(api, fireAt),
      data: {
        kind: 'pomodoro',
        ...(data ?? {}),
      },
    });
    const id = Number(result?.id);
    if (!Number.isFinite(id)) {
      logNotificationError('Pomodoro alarm returned invalid id');
      return;
    }
    const scheduledId = Math.floor(id);
    await savePomodoroAlarmEntry({ id: scheduledId, fireAtMs });
    logNotificationInfo('Pomodoro alarm scheduled', {
      alarmId: scheduledId,
      fireAt: new Date(fireAtMs).toISOString(),
    });
    // Cancel the superseded alarm only after its replacement exists, so an app
    // suspension mid-flight never leaves a running phase with no pending alert.
    // Skip when the ids match: the iOS module keys requests by creation second,
    // so a same-second reschedule already replaced the old request natively and
    // deleting the shared id would remove the alarm we just scheduled (#888).
    if (previousEntry && previousEntry.id !== scheduledId) {
      try {
        api.deleteAlarm(previousEntry.id);
        api.deleteRepeatingAlarm(previousEntry.id);
        if (!previousEntry.fireAtMs || previousEntry.fireAtMs > Date.now()) {
          api.removeFiredNotification(previousEntry.id);
        }
      } catch (error) {
        logNotificationError('Failed to cancel superseded pomodoro alarm', error);
      }
    }
  } catch (error) {
    logNotificationError('Failed to schedule pomodoro alarm', error);
  }
}

export async function startLocalMobileNotifications(): Promise<void> {
  if (started) {
    logNotificationInfo('Start requested while service is already running; rescheduling current reminders');
    const api = await loadAlarmApi();
    if (api) {
      await runRescheduleCycle(api);
    }
    return;
  }
  started = true;
  logNotificationInfo('Start requested', {
    platform: Platform.OS,
    platformVersion: String(Platform.Version),
  });

  const api = await loadAlarmApi();
  if (!api) {
    logNotificationInfo('Start aborted; alarm API unavailable');
    started = false;
    return;
  }

  const permission = await requestLocalNotificationPermission();
  if (!permission.granted) {
    logNotificationInfo('Start aborted; notification permission not granted', permission);
    await clearScheduledAlarms(api);
    started = false;
    return;
  }

  attachNativeEventListeners();
  await runRescheduleCycle(api);
  logNotificationInfo('Service started');

  storeSubscription?.();
  storeSubscription = useTaskStore.subscribe(nameNotifyListener('notification-reschedule', (state, prevState) => {
    // Reschedule cycles only read tasks, projects, and settings; skip store
    // updates (sync status, loading flags, editor Estado) that leave them untouched.
    if (
      state.tasks === prevState.tasks
      && state.projects === prevState.projects
      && state.settings === prevState.settings
    ) {
      return;
    }
    clearRescheduleTimer();
    rescheduleTimer = setTimeout(() => {
      rescheduleTimer = null;
      enqueueReschedule(api);
    }, STORE_RESCHEDULE_DEBOUNCE_MS);
  }));
}

export async function stopLocalMobileNotifications(): Promise<void> {
  logNotificationInfo('Stop requested');
  clearRescheduleTimer();
  clearNotificationEventRescheduleTimer();

  storeSubscription?.();
  storeSubscription = null;

  openSubscription?.remove();
  openSubscription = null;

  dismissSubscription?.remove();
  dismissSubscription = null;
  notificationOpenHandler = null;

  const api = await loadAlarmApi();
  await clearScheduledAlarms(api);
  resetRuntimeState();
  started = false;
  logNotificationInfo('Service stopped');
}

export async function getLocalNotificationPermissionStatus(): Promise<NotificationPermissionResult> {
  if (Platform.OS === 'android') {
    return getAndroidNotificationPermissionStatus();
  }
  return requestLocalNotificationPermission();
}

export const __localNotificationTestUtils = {
  loadAlarmMapIfNeeded,
  getAlarmMapSnapshot: () => new Map(alarmMap),
  getNotificationOpenHandler: () => notificationOpenHandler,
  isAlarmMapLoaded: () => loadedAlarmMap,
  resetForTests: () => {
    clearRescheduleTimer();
    storeSubscription?.();
    storeSubscription = null;
    openSubscription?.remove();
    openSubscription = null;
    dismissSubscription?.remove();
    dismissSubscription = null;
    started = false;
    alarmApi = null;
    alarmMap = new Map<string, LocalAlarmMapEntry>();
    loadedAlarmMap = false;
    resetRuntimeState();
  },
};
