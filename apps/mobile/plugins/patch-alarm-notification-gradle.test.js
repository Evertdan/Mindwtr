import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const plugin = require('./patch-alarm-notification-gradle');

const { PATCHES, applyPatches } = plugin.__testables;

// Every pure transform used to be its own named export in `__testables`; now
// each one lives on its PATCHES entry instead. Pulling them out by id keeps
// every test below unchanged — only the import mechanism moved.
const transformFor = (id) => {
  const patch = PATCHES.find((entry) => entry.id === id);
  if (!patch) throw new Error(`No PATCHES entry with id "${id}"`);
  return patch.transform;
};

const applyGradleCompatPatchToSource = transformFor('gradle-compat');
const applyAlarmPendingIntentPatchToSource = transformFor('alarm-pending-intent');
const applyAlarmDuplicateToastPatchToSource = transformFor('alarm-duplicate-toast');
const applyAlarmTimingPatchToSource = transformFor('alarm-timing');
// Same function as 'alarm-exact-repeat-receiver' — see PATCHES for why the
// one transform gets two registry entries (one per file it patches).
const applyAlarmExactRepeatPatchToSource = transformFor('alarm-exact-repeat-util');
const applyAlarmReminderBehaviorPatchToSource = transformFor('alarm-reminder-behavior');
const applyAlarmLockScreenPrivacyPatchToSource = transformFor('alarm-lock-screen-privacy');
const applyAlarmAudioInterfacePatchToSource = transformFor('alarm-audio-interface');
const applyAlarmDismissReceiverPatchToSource = transformFor('alarm-dismiss-receiver');
const applyAlarmReceiverPatchToSource = transformFor('alarm-receiver-dismiss-guard');
const applyAlarmCompleteConstantsPatchToSource = transformFor('alarm-complete-action-constants');
const applyAlarmTaskOpenIntentPatchToSource = transformFor('alarm-task-open-intent');
const applyAlarmCompleteUtilPatchToSource = transformFor('alarm-complete-action-util');
const applyAlarmCompleteReceiverPatchToSource = transformFor('alarm-complete-action-receiver');
const applyAlarmDeadRowUtilPatchToSource = transformFor('alarm-dead-row-util');
const applyAlarmActionDeadRowPatchToSource = transformFor('alarm-dead-row-actions');
const applyAlarmIosCompleteActionPatchToSource = transformFor('alarm-ios-complete-action');
const applyAlarmIosUniqueIdentifierPatchToSource = transformFor('alarm-ios-unique-identifier');
const applyAlarmIosDeletePendingPatchToSource = transformFor('alarm-ios-delete-pending-arg');

describe('patch-alarm-notification-gradle', () => {
  it('patches AlarmUtil pending intent flags for Android 12+', () => {
    const input = `class AlarmUtil {
    private NotificationManager getNotificationManager() {
        return null;
    }

    void demo(Context context, Intent intent, int id) {
        PendingIntent.getBroadcast(context, id, intent, 0);
        PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT);
    }
}`;

    const output = applyAlarmPendingIntentPatchToSource(input);

    expect(output).toContain('private int getImmutableFlag()');
    expect(output).toContain('PendingIntent.getBroadcast(context, id, intent, getImmutableFlag())');
    expect(output).toContain('PendingIntent.getActivity(context, id, intent, getUpdateCurrentImmutableFlags())');
  });

  it('removes the native duplicate alarm toast so JS retries stay silent', () => {
    const input = `    boolean checkAlarm(ArrayList<AlarmModel> alarms, AlarmModel alarm) {
        boolean contain = false;

        if (contain) {
            Toast.makeText(mContext, "You have already set this Alarm", Toast.LENGTH_SHORT).show();
        }

        return contain;
    }`;

    const output = applyAlarmDuplicateToastPatchToSource(input);

    expect(output).not.toContain('Toast.makeText');
    expect(output).toContain('Duplicate alarms are reported to JS via promise rejection');
    expect(output).toContain('return contain;');
  });

  it('patches Android task reminder timing for exact delivery and sane snooze', () => {
    const input = `class AlarmUtil {
    private AlarmManager getAlarmManager() {
        return (AlarmManager) mContext.getSystemService(Context.ALARM_SERVICE);
    }

    void setAlarm(Alarm alarm, AlarmManager alarmManager, Calendar calendar, PendingIntent alarmIntent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), alarmIntent);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), alarmIntent);
        } else {
            alarmManager.set(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), alarmIntent);
        }
    }

    void snoozeAlarm(AlarmModel alarm) {
        Calendar calendar = getCalendarFromAlarm(alarm);

        this.stopAlarmSound();

        calendar.add(Calendar.MINUTE, alarm.getSnoozeInterval());

        setAlarmFromCalendar(alarm, calendar);

        long time = System.currentTimeMillis() / 1000;

        alarm.setAlarmId((int) time);

        getAlarmDB().update(alarm);

        Log.e(TAG, "snooze data - " + alarm.toString());
    }
}`;

    const output = applyAlarmTimingPatchToSource(input);

    expect(output).toContain('private void setExactOrAllowWhileIdle');
    expect(output).toContain('alarmManager.canScheduleExactAlarms()');
    expect(output).toContain('alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, alarmIntent);');
    expect(output).toContain('alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, alarmIntent);');
    expect(output).toContain('setExactOrAllowWhileIdle(alarmManager, calendar.getTimeInMillis(), alarmIntent);');
    expect(output).not.toContain('alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), alarmIntent);');
    expect(output).toContain('Calendar calendar = Calendar.getInstance();');
    expect(output).not.toContain('Calendar calendar = getCalendarFromAlarm(alarm);');
    expect(output).toContain('int firedNotificationId = alarm.getAlarmId();');
    expect(output).toContain('getNotificationManager().cancel(firedNotificationId);');
    expect(output.indexOf('int firedNotificationId = alarm.getAlarmId();')).toBeLessThan(output.indexOf('alarm.setAlarmId((int) time);'));
    // Snooze schedules an independent alarm row so the JS reschedule cycle cannot reap it.
    expect(output).toContain('int snoozedAlarmRowId = getAlarmDB().insert(alarm);');
    expect(output).toContain('alarm.setId(snoozedAlarmRowId);');
    expect(output).not.toContain('getAlarmDB().update(alarm);');
    expect(output.indexOf('getNotificationManager().cancel(firedNotificationId);')).toBeGreaterThan(output.indexOf('int snoozedAlarmRowId = getAlarmDB().insert(alarm);'));
  });

  it('schedules repeating alarms as exact one-shots and advances stale boot times by wall clock', () => {
    const input = `class AlarmUtil {
    private void setExactOrAllowWhileIdle(AlarmManager alarmManager, long triggerAtMillis, PendingIntent alarmIntent) {
    }

    void setAlarm(AlarmModel alarm) {
        Calendar calendar = getCalendarFromAlarm(alarm);
        int alarmId = alarm.getAlarmId();
        Intent intent = new Intent(mContext, AlarmReceiver.class);
        intent.putExtra("PendingId", alarm.getId());
        PendingIntent alarmIntent = PendingIntent.getBroadcast(mContext, alarmId, intent, getImmutableFlag());
        AlarmManager alarmManager = this.getAlarmManager();
        String scheduleType = alarm.getScheduleType();

        if (scheduleType.equals("once")) {
            setExactOrAllowWhileIdle(alarmManager, calendar.getTimeInMillis(), alarmIntent);
        } else if (scheduleType.equals("repeat")) {
            long interval = this.getInterval(alarm.getInterval(), alarm.getIntervalValue());

            alarmManager.setRepeating(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), interval, alarmIntent);
        }
    }

    void snoozeAlarm(AlarmModel alarm) {
        Calendar calendar = Calendar.getInstance();
        PendingIntent alarmIntent = null;
        AlarmManager alarmManager = this.getAlarmManager();
        String scheduleType = alarm.getScheduleType();

        if (scheduleType.equals("once")) {
            setExactOrAllowWhileIdle(alarmManager, calendar.getTimeInMillis(), alarmIntent);
        } else if (scheduleType.equals("repeat")) {
            long interval = this.getInterval(alarm.getInterval(), alarm.getIntervalValue());

            alarmManager.setRepeating(AlarmManager.RTC_WAKEUP, calendar.getTimeInMillis(), interval, alarmIntent);
        }
    }

    long getInterval(String interval, int value) {
        return 0;
    }
}

class AlarmBootReceiver {
    void onReceive(ArrayList<AlarmModel> alarms, AlarmUtil alarmUtil) {
        for (AlarmModel alarm : alarms) {
            alarmUtil.setAlarm(alarm);
        }
    }
}`;

    const output = applyAlarmExactRepeatPatchToSource(input);

    expect(output).not.toContain('alarmManager.setRepeating(');
    expect(output.match(/setExactOrAllowWhileIdle\(alarmManager, calendar\.getTimeInMillis\(\), alarmIntent\);/g)).toHaveLength(4);
    expect(output).toContain('boolean advanced = advanceRepeatingAlarmToFuture(alarm, calendar);');
    expect(output).toContain('setAlarmFromCalendar(alarm, calendar);');
    expect(output).toContain('getAlarmDB().update(alarm);');
    expect(output).toContain('occurrence.add(Calendar.MINUTE, (int) totalAmount);');
    expect(output).toContain('occurrence.add(Calendar.HOUR_OF_DAY, (int) totalAmount);');
    expect(output).toContain('occurrence.add(Calendar.DAY_OF_YEAR, occurrenceCount);');
    expect(output).toContain('occurrence.add(Calendar.WEEK_OF_YEAR, occurrenceCount);');
    expect(output).toContain('searchSteps < MAX_REPEAT_SEARCH_STEPS');
    expect(output).toContain('MAX_REPEAT_SEARCH_STEPS = 64');
    expect(output).toContain('alarmUtil.setAlarm(alarm);');
    expect(output).toContain('void rescheduleRepeatingAlarm(AlarmModel alarm)');
    const rescheduleSource = output.slice(
      output.indexOf('void rescheduleRepeatingAlarm(AlarmModel alarm)'),
      output.indexOf('void setAlarm(AlarmModel alarm)')
    );
    expect(rescheduleSource).toContain('getAlarmDB().update(alarm);');
    expect(rescheduleSource).toContain('setAlarm(alarm);');
    expect(rescheduleSource).not.toContain('getAlarmDB().insert(alarm)');
    expect(rescheduleSource).not.toContain('alarm.setAlarmId(');
    expect(rescheduleSource).not.toContain('alarm.setId(');
    expect(output).toContain('int alarmId = alarm.getAlarmId();');
    expect(output).toContain('intent.putExtra("PendingId", alarm.getId());');
    expect(output).toContain('PendingIntent.getBroadcast(mContext, alarmId, intent, getImmutableFlag());');
    expect(applyAlarmExactRepeatPatchToSource(output)).toBe(output);
  });

  it('re-arms the next repeating occurrence after the receiver fires', () => {
    const input = `class AlarmReceiver {
    void onReceive(Context context, Intent intent) {
        alarm = alarmDB.getAlarm(id);

        alarmUtil.sendNotification(alarm);

        ArrayList<AlarmModel> alarms = alarmDB.getAlarmList(1);
    }
}`;

    const output = applyAlarmExactRepeatPatchToSource(input);

    expect(output).toContain('if ("repeat".equals(alarm.getScheduleType())) {');
    expect(output).toContain('alarmUtil.rescheduleRepeatingAlarm(alarm);');
    expect(output.indexOf('alarmUtil.rescheduleRepeatingAlarm(alarm);')).toBeGreaterThan(output.indexOf('alarmUtil.sendNotification(alarm);'));
    expect(applyAlarmExactRepeatPatchToSource(output)).toBe(output);
  });

  it('patches AlarmUtil reminder behavior away from alarm semantics', () => {
    const input = `class AlarmUtil {
    void init() {
        uri = Settings.System.DEFAULT_ALARM_ALERT_URI;
    }

    void send(Alarm alarm, NotificationCompat.Builder builder, Vibrator vibrator) {
        boolean playSound = alarm.isPlaySound();
        if (playSound) {
            this.playAlarmSound(alarm.getSoundName(), alarm.getSoundNames(), alarm.isLoopSound(), alarm.getVolume());
        }
        NotificationChannel mChannel = new NotificationChannel(channelID, "Alarm Notify", NotificationManager.IMPORTANCE_HIGH);
                mChannel.setVibrationPattern(null);

                // play vibration
                if (alarm.isVibrate()) {
                    Vibrator vibrator = (Vibrator) mContext.getSystemService(Context.VIBRATOR_SERVICE);
                    if (vibrator.hasVibrator()) {
                        vibrator.vibrate(VibrationEffect.createWaveform(vibrationPattern, 0));
                    }
                }
        builder.setPriority(NotificationCompat.PRIORITY_MAX);
        builder.setCategory(NotificationCompat.CATEGORY_ALARM);
        builder.setSound(null);
    }
}`;

    const output = applyAlarmReminderBehaviorPatchToSource(input);

    expect(output).toContain('Settings.System.DEFAULT_NOTIFICATION_URI');
    expect(output).not.toContain('this.playAlarmSound(');
    expect(output).toContain('NotificationManager.IMPORTANCE_DEFAULT');
    expect(output).toContain('NotificationCompat.PRIORITY_DEFAULT');
    expect(output).toContain('NotificationCompat.CATEGORY_REMINDER');
    expect(output).toContain('.setSound(playSound ? android.provider.Settings.System.DEFAULT_NOTIFICATION_URI : null)');
    expect(output).toContain('mChannel.enableVibration(alarm.isVibrate());');
    expect(output).toContain('mChannel.setSound(playSound ? android.provider.Settings.System.DEFAULT_NOTIFICATION_URI : null, null);');
  });

  it('marks reminder notifications private so the lock screen can redact them', () => {
    const input = `            NotificationCompat.Builder mBuilder = new NotificationCompat.Builder(mContext, channelID)
                    .setSmallIcon(smallIconResId)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setCategory(NotificationCompat.CATEGORY_REMINDER);`;

    const output = applyAlarmLockScreenPrivacyPatchToSource(input);

    expect(output).toContain('.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)');
    expect(output).not.toContain('VISIBILITY_PUBLIC');
    expect(applyAlarmLockScreenPrivacyPatchToSource(output)).toBe(output);
  });

  it('patches AudioInterface fallback sound away from the alarm tone', () => {
    const input = `class AudioInterface {
    void init(Context context) {
        uri = Settings.System.DEFAULT_ALARM_ALERT_URI;
    }
}`;

    const output = applyAlarmAudioInterfacePatchToSource(input);

    expect(output).toContain('Settings.System.DEFAULT_NOTIFICATION_URI');
    expect(output).not.toContain('Settings.System.DEFAULT_ALARM_ALERT_URI');
  });

  it('patches dismiss receiver to cancel alarms even without a React context', () => {
    const input = `        try {
            if (ANModule.getReactAppContext() != null) {
                int notificationId = intent.getExtras().getInt(Constants.DISMISSED_NOTIFICATION_ID);
                ANModule.getReactAppContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("OnNotificationDismissed", "{\\"id\\": \\"" + notificationId + "\\"}");

                alarmUtil.removeFiredNotification(notificationId);

                alarmUtil.doCancelAlarm(notificationId);
            }
        } catch (Exception e) {`;

    const output = applyAlarmDismissReceiverPatchToSource(input);

    expect(output).not.toContain('if (ANModule.getReactAppContext() != null) {\n                int notificationId');
    expect(output).toContain('int notificationId = intent.getExtras().getInt(Constants.DISMISSED_NOTIFICATION_ID);');
    expect(output).toContain('alarmUtil.doCancelAlarm(notificationId);');
    expect(output).toContain('alarmUtil.stopAlarmSound();');
  });

  it('guards dismiss event emission when the React context is missing', () => {
    const input = `                            // emit notification dismissed
                            ANModule.getReactAppContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("OnNotificationDismissed", "{\\"id\\": \\"" + alarm.getId() + "\\"}");
`;

    const output = applyAlarmReceiverPatchToSource(input);

    expect(output).toContain('if (ANModule.getReactAppContext() != null) {');
    expect(output).toContain('emit("OnNotificationDismissed"');
  });

  it('adds an Android complete notification action from task reminder data', () => {
    const constants = applyAlarmCompleteConstantsPatchToSource(`class Constants {
    static final String NOTIFICATION_ACTION_SNOOZE = "ACTION_SNOOZE";
}`);
    expect(constants).toContain('NOTIFICATION_ACTION_COMPLETE');

    const openIntent = applyAlarmTaskOpenIntentPatchToSource(`import android.media.MediaPlayer;
class AlarmUtil {
    void send(Alarm alarm, Bundle bundle, Intent intent, Context mContext, int notificationID) {
            PendingIntent pendingIntent = PendingIntent.getActivity(mContext, notificationID, intent, getUpdateCurrentImmutableFlags());
    }
}`);
    expect(openIntent).toContain('import android.net.Uri;');
    expect(openIntent).toContain('String taskId = bundle.getString("taskId")');
    expect(openIntent).toContain('intent.setAction(Intent.ACTION_VIEW)');
    expect(openIntent).toContain('Uri.parse("mindwtr:///focus")');
    expect(openIntent).toContain('.appendQueryParameter("taskId", taskId)');
    expect(openIntent).toContain('.appendQueryParameter("taskTab", "view")');

    const util = applyAlarmCompleteUtilPatchToSource(`import static com.emekalites.react.alarm.notification.Constants.NOTIFICATION_ACTION_DISMISS;
import static com.emekalites.react.alarm.notification.Constants.NOTIFICATION_ACTION_SNOOZE;
class AlarmUtil {
    void send(Alarm alarm, Bundle bundle, NotificationCompat.Builder mBuilder, Context mContext, int notificationID) {
            if (alarm.isHasButton()) {
                Intent dismissIntent = new Intent(mContext, AlarmReceiver.class);
                dismissIntent.setAction(NOTIFICATION_ACTION_DISMISS);
                dismissIntent.putExtra("AlarmId", alarm.getId());
                PendingIntent pendingDismiss = PendingIntent.getBroadcast(mContext, notificationID, dismissIntent, getUpdateCurrentImmutableFlags());
                NotificationCompat.Action dismissAction = new NotificationCompat.Action(android.R.drawable.ic_lock_idle_alarm, "DISMISS", pendingDismiss);
                mBuilder.addAction(dismissAction);

                Intent snoozeIntent = new Intent(mContext, AlarmReceiver.class);
                snoozeIntent.setAction(NOTIFICATION_ACTION_SNOOZE);
                snoozeIntent.putExtra("SnoozeAlarmId", alarm.getId());
                PendingIntent pendingSnooze = PendingIntent.getBroadcast(mContext, notificationID, snoozeIntent, getUpdateCurrentImmutableFlags());
                NotificationCompat.Action snoozeAction = new NotificationCompat.Action(R.drawable.ic_snooze, "SNOOZE", pendingSnooze);
                mBuilder.addAction(snoozeAction);
            }
    }
}`);
    expect(util).toContain('NOTIFICATION_ACTION_COMPLETE');
    expect(util).toContain('notificationActionComplete');
    expect(util).toContain('"COMPLETE"');

    const receiver = applyAlarmCompleteReceiverPatchToSource(`import android.content.Intent;
class AlarmReceiver {
    void onReceive(Context context, Intent intent) {
                switch (action) {
                    case Constants.NOTIFICATION_ACTION_DISMISS:
                        id = intent.getExtras().getInt("AlarmId");
                }
    }
}`);
    expect(receiver).toContain('case Constants.NOTIFICATION_ACTION_COMPLETE');
    expect(receiver).toContain('payload.putString("actionIdentifier", "complete")');
    expect(receiver).toContain('NotificationOpenPayloadStore.cache(pendingPayload)');
    expect(receiver).toContain('emit("OnNotificationOpened"');
  });

  it('carries the tray notification post id on every action intent so a dead alarm row can still be cleared (#1028)', () => {
    const input = `class AlarmUtil {
    private NotificationManager getNotificationManager() {
        return null;
    }

    void send(Alarm alarm, Bundle bundle, NotificationCompat.Builder mBuilder, Context mContext, int notificationID) {
            if (alarm.isHasButton()) {
                boolean hasCompleteAction = "true".equals(bundle.getString("notificationActionComplete"));
                if (hasCompleteAction) {
                    Intent completeIntent = new Intent(mContext, AlarmReceiver.class);
                    completeIntent.setAction(NOTIFICATION_ACTION_COMPLETE);
                    completeIntent.putExtra("AlarmId", alarm.getId());
                    completeIntent.putExtras(bundle);
                    PendingIntent pendingComplete = PendingIntent.getBroadcast(mContext, notificationID + 2, completeIntent, getUpdateCurrentImmutableFlags());
                    NotificationCompat.Action completeAction = new NotificationCompat.Action(android.R.drawable.checkbox_on_background, "COMPLETE", pendingComplete);
                    mBuilder.addAction(completeAction);
                }

                Intent snoozeIntent = new Intent(mContext, AlarmReceiver.class);
                snoozeIntent.setAction(NOTIFICATION_ACTION_SNOOZE);
                snoozeIntent.putExtra("SnoozeAlarmId", alarm.getId());
                PendingIntent pendingSnooze = PendingIntent.getBroadcast(mContext, notificationID + 1, snoozeIntent, getUpdateCurrentImmutableFlags());
                NotificationCompat.Action snoozeAction = new NotificationCompat.Action(R.drawable.ic_snooze, "SNOOZE", pendingSnooze);
                mBuilder.addAction(snoozeAction);

                Intent dismissIntent = new Intent(mContext, AlarmReceiver.class);
                dismissIntent.setAction(NOTIFICATION_ACTION_DISMISS);
                dismissIntent.putExtra("AlarmId", alarm.getId());
                PendingIntent pendingDismiss = PendingIntent.getBroadcast(mContext, notificationID, dismissIntent, getUpdateCurrentImmutableFlags());
                NotificationCompat.Action dismissAction = new NotificationCompat.Action(android.R.drawable.ic_lock_idle_alarm, "DISMISS", pendingDismiss);
                mBuilder.addAction(dismissAction);
            }
    }

    void removeAllFiredNotifications() {
        getNotificationManager().cancelAll();
    }
}`;

    const output = applyAlarmDeadRowUtilPatchToSource(input);

    // Every action intent gets the notification's real post id, not just the
    // DB row id it already carried — removeFiredNotification(id) resolves
    // the row id back to the post id via a DB lookup, which fails silently
    // once the row is gone.
    expect(output).toContain('completeIntent.putExtra("NotificationId", notificationID);');
    expect(output).toContain('snoozeIntent.putExtra("NotificationId", notificationID);');
    expect(output).toContain('dismissIntent.putExtra("NotificationId", notificationID);');
    expect(output.indexOf('completeIntent.putExtra("AlarmId"')).toBeLessThan(output.indexOf('completeIntent.putExtra("NotificationId"'));
    expect(output).toContain('void clearNotification(int notificationId)');
    expect(output).toContain('getNotificationManager().cancel(notificationId);');
    // Idempotent: a second pass leaves the patched source untouched.
    expect(applyAlarmDeadRowUtilPatchToSource(output)).toBe(output);
  });

  it('throws naming the missing marker when one action-intent anchor silently drifts', () => {
    // Same fixture as above, except the completeIntent anchor picked up a
    // trailing comment (as if upstream reformatted just that one line). The
    // other two intents and the clearNotification helper still patch fine,
    // so a bare "did anything change" check would pass this through with the
    // dead-row fix silently missing from the COMPLETE action — the one that
    // matters most, since it's the one that delivers the task payload.
    const input = `class AlarmUtil {
    private NotificationManager getNotificationManager() {
        return null;
    }

    void send(Alarm alarm, Bundle bundle, NotificationCompat.Builder mBuilder, Context mContext, int notificationID) {
            if (alarm.isHasButton()) {
                boolean hasCompleteAction = "true".equals(bundle.getString("notificationActionComplete"));
                if (hasCompleteAction) {
                    Intent completeIntent = new Intent(mContext, AlarmReceiver.class);
                    completeIntent.setAction(NOTIFICATION_ACTION_COMPLETE);
                    completeIntent.putExtra("AlarmId", alarm.getId()); // vendor reformat
                    completeIntent.putExtras(bundle);
                    PendingIntent pendingComplete = PendingIntent.getBroadcast(mContext, notificationID + 2, completeIntent, getUpdateCurrentImmutableFlags());
                    NotificationCompat.Action completeAction = new NotificationCompat.Action(android.R.drawable.checkbox_on_background, "COMPLETE", pendingComplete);
                    mBuilder.addAction(completeAction);
                }

                Intent snoozeIntent = new Intent(mContext, AlarmReceiver.class);
                snoozeIntent.setAction(NOTIFICATION_ACTION_SNOOZE);
                snoozeIntent.putExtra("SnoozeAlarmId", alarm.getId());
                PendingIntent pendingSnooze = PendingIntent.getBroadcast(mContext, notificationID + 1, snoozeIntent, getUpdateCurrentImmutableFlags());
                NotificationCompat.Action snoozeAction = new NotificationCompat.Action(R.drawable.ic_snooze, "SNOOZE", pendingSnooze);
                mBuilder.addAction(snoozeAction);

                Intent dismissIntent = new Intent(mContext, AlarmReceiver.class);
                dismissIntent.setAction(NOTIFICATION_ACTION_DISMISS);
                dismissIntent.putExtra("AlarmId", alarm.getId());
                PendingIntent pendingDismiss = PendingIntent.getBroadcast(mContext, notificationID, dismissIntent, getUpdateCurrentImmutableFlags());
                NotificationCompat.Action dismissAction = new NotificationCompat.Action(android.R.drawable.ic_lock_idle_alarm, "DISMISS", pendingDismiss);
                mBuilder.addAction(dismissAction);
            }
    }

    void removeAllFiredNotifications() {
        getNotificationManager().cancelAll();
    }
}`;

    expect(() => applyAlarmDeadRowUtilPatchToSource(input)).toThrow(
      'alarm-dead-row-util: expected marker not found after transform: completeIntent.putExtra("NotificationId", notificationID);'
    );
  });

  it('hardens all three notification actions against a dead alarm row (#1028)', () => {
    const input = `class AlarmReceiver {
    void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (action != null) {
                switch (action) {
                    case Constants.NOTIFICATION_ACTION_SNOOZE:
                        id = intent.getExtras().getInt("SnoozeAlarmId");

                        try {
                            alarm = alarmDB.getAlarm(id);
                            alarmUtil.snoozeAlarm(alarm);
                            Log.e(TAG, "alarm snoozed: " + alarm.toString());

                            alarmUtil.removeFiredNotification(alarm.getId());
                        } catch (Exception e) {
                            alarmUtil.stopAlarmSound();
                            e.printStackTrace();
                        }
                        break;

                    case Constants.NOTIFICATION_ACTION_COMPLETE:
                        id = intent.getExtras().getInt("AlarmId");

                        try {
                            alarm = alarmDB.getAlarm(id);
                            Bundle payload = new Bundle();
                            if (intent.getExtras() != null) {
                                payload.putAll(intent.getExtras());
                            }
                            payload.putString("id", String.valueOf(alarm.getId()));
                            if (payload.getString("alarmKey") == null && payload.getString("taskId") != null) {
                                payload.putString("alarmKey", "task:" + payload.getString("taskId"));
                            }
                            payload.putString("actionIdentifier", "complete");
                            LinkedHashMap<String, String> pendingPayload = new LinkedHashMap<>();
                            for (String key : payload.keySet()) {
                                Object value = payload.get(key);
                                if (value != null) {
                                    pendingPayload.put(key, String.valueOf(value));
                                }
                            }
                            NotificationOpenPayloadStore.cache(pendingPayload);

                            alarmUtil.removeFiredNotification(alarm.getId());
                            alarmUtil.cancelAlarm(alarm, false);
                            alarmUtil.stopAlarmSound();

                            if (ANModule.getReactAppContext() != null) {
                                ANModule.getReactAppContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("OnNotificationOpened", BundleJSONConverter.convertToJSON(payload).toString());
                            } else {
                                Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                                if (launchIntent != null) {
                                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                                    launchIntent.putExtras(payload);
                                    context.startActivity(launchIntent);
                                }
                            }
                        } catch (Exception e) {
                            alarmUtil.stopAlarmSound();
                            e.printStackTrace();
                        }
                        break;

                    case Constants.NOTIFICATION_ACTION_DISMISS:
                        id = intent.getExtras().getInt("AlarmId");

                        try {
                            alarm = alarmDB.getAlarm(id);
                            Log.e(TAG, "alarm cancelled: " + alarm.toString());

                            // emit notification dismissed
                            if (ANModule.getReactAppContext() != null) {
                                ANModule.getReactAppContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("OnNotificationDismissed", "{\\"id\\": \\"" + alarm.getId() + "\\"}");
                            }

                            alarmUtil.removeFiredNotification(alarm.getId());
                            ${''}
                            alarmUtil.cancelAlarm(alarm, false);
                        } catch (Exception e) {
                            alarmUtil.stopAlarmSound();
                            e.printStackTrace();
                        }
                        break;
                }
            }
    }
}`;

    const output = applyAlarmActionDeadRowPatchToSource(input);

    // (a) every case gets a null-alarm branch that clears the tray notification.
    const snoozeCase = output.slice(output.indexOf('NOTIFICATION_ACTION_SNOOZE'), output.indexOf('NOTIFICATION_ACTION_COMPLETE'));
    const completeCase = output.slice(output.indexOf('NOTIFICATION_ACTION_COMPLETE'), output.indexOf('NOTIFICATION_ACTION_DISMISS'));
    const dismissCase = output.slice(output.indexOf('NOTIFICATION_ACTION_DISMISS'));

    expect(snoozeCase).toContain('if (alarm != null) {');
    expect(snoozeCase).toContain('alarmUtil.clearNotification(intent.getExtras().getInt("NotificationId"));');
    expect(completeCase).toContain('if (alarm != null) {');
    expect(completeCase).toContain('alarmUtil.clearNotification(intent.getExtras().getInt("NotificationId"));');
    expect(dismissCase).toContain('if (alarm != null) {');
    expect(dismissCase).toContain('alarmUtil.clearNotification(intent.getExtras().getInt("NotificationId"));');

    // Every case receipts before doing anything else.
    expect(output).toContain('Log.d(TAG, "ACTION_SNOOZE id=" + id + " alarmFound=" + (alarm != null));');
    expect(output).toContain('Log.d(TAG, "ACTION_COMPLETE id=" + id + " alarmFound=" + (alarm != null));');
    expect(output).toContain('Log.d(TAG, "ACTION_DISMISS id=" + id + " alarmFound=" + (alarm != null));');

    // (b) COMPLETE's dead-row path builds the payload from intent extras,
    // falling back to the intent's own id instead of dereferencing a null alarm.
    expect(completeCase).toContain('payload.putString("id", String.valueOf(alarm != null ? alarm.getId() : id));');
    expect(completeCase).toContain('payload.putAll(intent.getExtras());');
    expect(completeCase).toContain('emit("OnNotificationOpened"');

    // (c) SNOOZE's dead-row path never inserts/updates an alarm row — it
    // degrades to a plain dismiss instead of reconstructing schedule state.
    const snoozeDeadRowBranch = snoozeCase.slice(snoozeCase.indexOf('else if (intent.getExtras()'));
    expect(snoozeDeadRowBranch).not.toContain('getAlarmDB().insert(');
    expect(snoozeDeadRowBranch).not.toContain('getAlarmDB().update(');
    expect(snoozeDeadRowBranch).not.toContain('alarmUtil.snoozeAlarm(');

    // DISMISS still emits with the intent's id, not a dereferenced null alarm.
    expect(dismissCase).toContain('emit("OnNotificationDismissed", "{\\"id\\": \\"" + id + "\\"}");');

    // Idempotent: a second pass leaves the patched source untouched.
    expect(applyAlarmActionDeadRowPatchToSource(output)).toBe(output);
  });

  it('throws naming the missing marker when one case anchor silently drifts', () => {
    // Same fixture as above, except the SNOOZE case's removeFiredNotification
    // line picked up a trailing comment (as if upstream touched just that one
    // case). COMPLETE and DISMISS still patch fine — a build that only
    // re-checks "did the file change" would succeed on the first prebuild and
    // only throw on the *next* one, once the idempotency guard's early-return
    // marker is present but the SNOOZE case never actually got hardened.
    const input = `class AlarmReceiver {
    void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (action != null) {
                switch (action) {
                    case Constants.NOTIFICATION_ACTION_SNOOZE:
                        id = intent.getExtras().getInt("SnoozeAlarmId");

                        try {
                            alarm = alarmDB.getAlarm(id);
                            alarmUtil.snoozeAlarm(alarm);
                            Log.e(TAG, "alarm snoozed: " + alarm.toString());

                            alarmUtil.removeFiredNotification(alarm.getId()); // vendor reformat
                        } catch (Exception e) {
                            alarmUtil.stopAlarmSound();
                            e.printStackTrace();
                        }
                        break;

                    case Constants.NOTIFICATION_ACTION_COMPLETE:
                        id = intent.getExtras().getInt("AlarmId");

                        try {
                            alarm = alarmDB.getAlarm(id);
                            Bundle payload = new Bundle();
                            if (intent.getExtras() != null) {
                                payload.putAll(intent.getExtras());
                            }
                            payload.putString("id", String.valueOf(alarm.getId()));
                            if (payload.getString("alarmKey") == null && payload.getString("taskId") != null) {
                                payload.putString("alarmKey", "task:" + payload.getString("taskId"));
                            }
                            payload.putString("actionIdentifier", "complete");
                            LinkedHashMap<String, String> pendingPayload = new LinkedHashMap<>();
                            for (String key : payload.keySet()) {
                                Object value = payload.get(key);
                                if (value != null) {
                                    pendingPayload.put(key, String.valueOf(value));
                                }
                            }
                            NotificationOpenPayloadStore.cache(pendingPayload);

                            alarmUtil.removeFiredNotification(alarm.getId());
                            alarmUtil.cancelAlarm(alarm, false);
                            alarmUtil.stopAlarmSound();

                            if (ANModule.getReactAppContext() != null) {
                                ANModule.getReactAppContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("OnNotificationOpened", BundleJSONConverter.convertToJSON(payload).toString());
                            } else {
                                Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
                                if (launchIntent != null) {
                                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                                    launchIntent.putExtras(payload);
                                    context.startActivity(launchIntent);
                                }
                            }
                        } catch (Exception e) {
                            alarmUtil.stopAlarmSound();
                            e.printStackTrace();
                        }
                        break;

                    case Constants.NOTIFICATION_ACTION_DISMISS:
                        id = intent.getExtras().getInt("AlarmId");

                        try {
                            alarm = alarmDB.getAlarm(id);
                            Log.e(TAG, "alarm cancelled: " + alarm.toString());

                            // emit notification dismissed
                            if (ANModule.getReactAppContext() != null) {
                                ANModule.getReactAppContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("OnNotificationDismissed", "{\\"id\\": \\"" + alarm.getId() + "\\"}");
                            }

                            alarmUtil.removeFiredNotification(alarm.getId());
                            ${''}
                            alarmUtil.cancelAlarm(alarm, false);
                        } catch (Exception e) {
                            alarmUtil.stopAlarmSound();
                            e.printStackTrace();
                        }
                        break;
                }
            }
    }
}`;

    expect(() => applyAlarmActionDeadRowPatchToSource(input)).toThrow(
      'alarm-dead-row-actions: expected marker not found after transform: Log.d(TAG, "ACTION_SNOOZE id="'
    );
  });

  it('adds iOS complete actions and exposes pending action payloads', () => {
    const input = `#import "RnAlarmNotification.h"

static NSString *const kLocalNotificationReceived = @"LocalNotificationReceived";
static id _sharedInstance = nil;

API_AVAILABLE(ios(10.0))
static NSDictionary *RCTFormatUNNotification(UNNotification *notification) {
    NSMutableDictionary *formattedNotification = [NSMutableDictionary dictionary];
    UNNotificationContent *content = notification.request.content;

    formattedNotification[@"id"] = notification.request.identifier;
    formattedNotification[@"data"] = RCTNullIfNil([content.userInfo objectForKey:@"data"]);

    return formattedNotification;
}

static NSDateComponents *parseDate(NSString *dateString) {
    return nil;
}

static NSString *stringify(NSDictionary *notification) {
    return @"{}";
}

@implementation RnAlarmNotification

RCT_EXPORT_MODULE(RNAlarmNotification);

+ (void)didReceiveNotificationResponse:(UNNotificationResponse *)response
API_AVAILABLE(ios(10.0)) {
    NSLog(@"show notification");
    [[UIApplication sharedApplication] setIdleTimerDisabled:NO];
    if ([response.notification.request.content.categoryIdentifier isEqualToString:@"CUSTOM_ACTIONS"]) {
       if ([response.actionIdentifier isEqualToString:@"SNOOZE_ACTION"]) {
           [RnAlarmNotification snoozeAlarm:response.notification];
       } else if ([response.actionIdentifier isEqualToString:@"DISMISS_ACTION"]) {
           NSLog(@"do dismiss");
           [RnAlarmNotification stopSound];

           NSMutableDictionary *notification = [NSMutableDictionary dictionary];
           notification[@"id"] = response.notification.request.identifier;

           [[NSNotificationCenter defaultCenter] postNotificationName:kLocalNotificationDismissed
                                                               object:self
                                                             userInfo:notification];
       }
    }

    // send notification
    [[NSNotificationCenter defaultCenter] postNotificationName:kLocalNotificationReceived
                                                        object:self
                                                      userInfo:RCTFormatUNNotification(response.notification)];
}

- (void)startObserving {
}

- (void)demo {
            if([details[@"has_button"] isEqualToNumber: [NSNumber numberWithInt: 1]]){
                content.categoryIdentifier = @"CUSTOM_ACTIONS";
            }
            content.userInfo = @{
                @"has_button": details[@"has_button"],
                @"schedule_type": details[@"schedule_type"]
            };
            content.userInfo = @{
                @"has_button": [contentInfo.userInfo objectForKey:@"has_button"],
                @"schedule_type": [contentInfo.userInfo objectForKey:@"schedule_type"]
            };

        UNNotificationAction* snoozeAction = [UNNotificationAction
              actionWithIdentifier:@"SNOOZE_ACTION"
              title:@"SNOOZE"
              options:UNNotificationActionOptionNone];

        UNNotificationAction* stopAction = [UNNotificationAction
              actionWithIdentifier:@"DISMISS_ACTION"
              title:@"DISMISS"
              options:UNNotificationActionOptionForeground];

        UNNotificationCategory* customCategory = [UNNotificationCategory
            categoryWithIdentifier:@"CUSTOM_ACTIONS"
            actions:@[snoozeAction, stopAction]
            intentIdentifiers:@[]
            options:UNNotificationCategoryOptionNone];
}

@end`;

    const output = applyAlarmIosCompleteActionPatchToSource(input);

    expect(output).toContain('RCTFormatUNNotificationWithAction');
    expect(output).toContain('consumePendingNotificationOpenPayload');
    expect(output).toContain('actionWithIdentifier:@"COMPLETE_ACTION"');
    expect(output).toContain('cachePendingNotificationOpenPayload(formattedNotification)');
    // Nil-safe injection: a caller omitting has_complete_action (the pomodoro
    // path) must not raise NSInvalidArgumentException from the userInfo
    // dictionary literal (#888).
    expect(output).toContain('@"has_complete_action": (details[@"has_complete_action"] ?: @NO)');
    expect(output).toContain('@"has_complete_action": ([contentInfo.userInfo objectForKey:@"has_complete_action"] ?: @NO)');
    expect(output).not.toContain('@"has_complete_action": details[@"has_complete_action"],');
  });

  it('makes iOS notification identifiers unique instead of epoch-second shared', () => {
    const input = `#import "RnAlarmNotification.h"

static id _sharedInstance = nil;

@implementation RnAlarmNotification

- (void)snoozeDemo {
            NSString *alarmId = [NSString stringWithFormat: @"%ld", (long) NSDate.date.timeIntervalSince1970];
}

- (void)scheduleDemo {
            NSString *alarmId = [NSString stringWithFormat: @"%ld", (long) NSDate.date.timeIntervalSince1970];
}

- (void)sendDemo {
            NSString *alarmId = [NSString stringWithFormat: @"%ld", (long) NSDate.date.timeIntervalSince1970];
}

@end`;

    const output = applyAlarmIosUniqueIdentifierPatchToSource(input);

    expect(output).toContain('static int64_t mindwtrAlarmIdCounter = 0;');
    expect(output).not.toContain('@"%ld", (long) NSDate.date.timeIntervalSince1970');
    const rewrittenSites = output.match(/mindwtrAlarmIdCounter = \(mindwtrAlarmIdCounter \+ 1\) % 1000;/g) ?? [];
    expect(rewrittenSites).toHaveLength(3);
    expect(output).toContain('((int64_t)(NSDate.date.timeIntervalSince1970 * 1000.0)) * 1000 + mindwtrAlarmIdCounter');
    // Idempotent: a second pass leaves the patched source untouched.
    expect(applyAlarmIosUniqueIdentifierPatchToSource(output)).toBe(output);
  });

  it('takes the iOS cancel ids by value so pending requests are actually removed', () => {
    const input = `RCT_EXPORT_METHOD(deleteAlarm: (NSInteger *)id){
    NSArray *array = [NSArray arrayWithObjects:[NSString stringWithFormat:@"%li", (long)id], nil];
}

RCT_EXPORT_METHOD(deleteRepeatingAlarm: (NSInteger *)id){
    NSArray *array = [NSArray arrayWithObjects:[NSString stringWithFormat:@"%li", (long)id], nil];
}

RCT_EXPORT_METHOD(removeFiredNotification: (NSInteger)id){
}`;

    const output = applyAlarmIosDeletePendingPatchToSource(input);

    expect(output).toContain('RCT_EXPORT_METHOD(deleteAlarm: (NSInteger)id)');
    expect(output).toContain('RCT_EXPORT_METHOD(deleteRepeatingAlarm: (NSInteger)id)');
    expect(output).not.toContain('(NSInteger *)id');
    // The sibling that already took its id by value must be left alone.
    expect(output).toContain('RCT_EXPORT_METHOD(removeFiredNotification: (NSInteger)id)');
    // Idempotent: a second pass leaves the patched source untouched.
    expect(applyAlarmIosDeletePendingPatchToSource(output)).toBe(output);
  });

  it('keeps the Gradle compatibility rewrite in place', () => {
    const input = `apply plugin: 'maven'
buildscript {
  dependencies {
    classpath 'com.android.tools.build:gradle:3.4.1'
  }
}

android {
  compileSdkVersion safeExtGet('compileSdkVersion', DEFAULT_COMPILE_SDK_VERSION)
}

dependencies {
    //noinspection GradleDynamicVersion
    implementation 'com.facebook.react:react-native:+'  // From node_modules
    implementation 'com.google.code.gson:gson:2.8.6'
}

afterEvaluate { project ->
  // legacy publishing tasks
}`;

    const output = applyGradleCompatPatchToSource(input);

    expect(output).not.toContain("apply plugin: 'maven'");
    expect(output).toContain("compileSdk safeExtGet('compileSdkVersion', DEFAULT_COMPILE_SDK_VERSION)");
    expect(output).not.toContain('afterEvaluate { project ->');
    expect(output.slice(0, output.indexOf('android {'))).not.toContain('notification-open-intents');
    expect(output).toContain("classpath 'com.android.tools.build:gradle:3.4.1'");
    expect(output).toContain("implementation project(':notification-open-intents')");
    expect(output.indexOf("classpath 'com.android.tools.build:gradle:3.4.1'")).toBeLessThan(output.indexOf("implementation project(':notification-open-intents')"));
    expect(applyGradleCompatPatchToSource(output).match(/notification-open-intents/g)).toHaveLength(2);
  });
});

describe('PATCHES registry completeness', () => {
  // Pinned verbatim from the original per-candidate loops this task replaced
  // (17 (file, transform) call sites from 16 distinct transforms —
  // applyAlarmExactRepeatPatchToSource was called against both AlarmUtil.java
  // and AlarmReceiver.java, hence 17 sites from 16 functions). This list is
  // NOT derived from PATCHES: a test that only iterates PATCHES would shrink
  // in lockstep with a bug that silently drops a registry entry and never
  // catch it. Pinning the old list independently is what makes a dropped
  // entry visible.
  const ORIGINAL_CALL_SITES = [
    ['build.gradle', 'applyGradleCompatPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmPendingIntentPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmTaskOpenIntentPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmDuplicateToastPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmTimingPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmExactRepeatPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmReminderBehaviorPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmLockScreenPrivacyPatchToSource'],
    ['AlarmUtil.java', 'applyAlarmCompleteUtilPatchToSource'],
    ['AudioInterface.java', 'applyAlarmAudioInterfacePatchToSource'],
    ['AlarmDismissReceiver.java', 'applyAlarmDismissReceiverPatchToSource'],
    ['AlarmReceiver.java', 'applyAlarmReceiverPatchToSource'],
    ['AlarmReceiver.java', 'applyAlarmExactRepeatPatchToSource'],
    ['AlarmReceiver.java', 'applyAlarmCompleteReceiverPatchToSource'],
    ['Constants.java', 'applyAlarmCompleteConstantsPatchToSource'],
    ['RnAlarmNotification.m', 'applyAlarmIosCompleteActionPatchToSource'],
    ['RnAlarmNotification.m', 'applyAlarmIosUniqueIdentifierPatchToSource'],
    // Added after the collapse (#1020), pinned here for the same reason as the
    // original sites: dropping it silently restores the duplicate-reminder leak.
    ['RnAlarmNotification.m', 'applyAlarmIosDeletePendingPatchToSource'],
    // Added for #1028: dropping either silently restores the dead-row silent
    // no-op on a notification action tap.
    ['AlarmUtil.java', 'applyAlarmDeadRowUtilPatchToSource'],
    ['AlarmReceiver.java', 'applyAlarmActionDeadRowPatchToSource'],
  ];

  it('has exactly one registry entry per original call site — none dropped in the collapse', () => {
    const fakeRoot = '/fake-project-root';
    const actual = PATCHES.map((patch) => {
      const [firstCandidate] = patch.getCandidates(fakeRoot);
      return [path.basename(firstCandidate), patch.transform.name];
    });
    const normalize = (pairs) => pairs.map(([file, name]) => `${file}::${name}`).sort();
    expect(normalize(actual)).toEqual(normalize(ORIGINAL_CALL_SITES));
  });

  it('every entry declares required/firstMatchOnly explicitly', () => {
    expect(PATCHES).toHaveLength(20);
    for (const patch of PATCHES) {
      expect(typeof patch.id).toBe('string');
      expect(typeof patch.required).toBe('boolean');
      expect(typeof patch.firstMatchOnly).toBe('boolean');
      expect(typeof patch.transform).toBe('function');
      expect(typeof patch.getCandidates).toBe('function');
    }
  });
});

describe('applyPatches (registry-driven fixture tree)', () => {
  const androidJavaPath = (projectRoot, fileName) => path.join(
    projectRoot,
    'node_modules',
    'react-native-alarm-notification',
    'android',
    'src',
    'main',
    'java',
    'com',
    'emekalites',
    'react',
    'alarm',
    'notification',
    fileName
  );

  const writeFixture = (filePath, content) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  it("throws naming the patch id when a required patch's anchor no longer matches upstream", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-patch-fixture-'));
    try {
      writeFixture(
        androidJavaPath(projectRoot, 'AudioInterface.java'),
        `class AudioInterface {
    void init(Context context) {
        uri = Settings.System.SOME_RENAMED_URI_UPSTREAM;
    }
}`
      );

      const audioPatch = PATCHES.find((patch) => patch.id === 'alarm-audio-interface');
      expect(audioPatch.required).toBe(true);
      expect(() => applyPatches(projectRoot, [audioPatch])).toThrow(/alarm-audio-interface/);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not throw when a declared-optional patch fails to match (alarm-duplicate-toast)', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-patch-fixture-'));
    try {
      writeFixture(
        androidJavaPath(projectRoot, 'AlarmUtil.java'),
        'class AlarmUtil {\n    // upstream rewrote checkAlarm entirely, no Toast left to remove\n}'
      );

      const toastPatch = PATCHES.find((patch) => patch.id === 'alarm-duplicate-toast');
      expect(toastPatch.required).toBe(false);
      expect(() => applyPatches(projectRoot, [toastPatch])).not.toThrow();
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('running applyPatches twice against the real installed package succeeds both times and converges', () => {
    const realPackageRoot = path.join(__dirname, '..', '..', '..', 'node_modules', 'react-native-alarm-notification');
    if (!fs.existsSync(realPackageRoot)) {
      // react-native-alarm-notification isn't installed in this environment
      // (e.g. a pruned/production install) — nothing to verify against.
      return;
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-patch-real-'));
    try {
      // Mirror the real monorepo layout (apps/mobile, two levels below the
      // repo root) so the hoisted candidate path resolves the same way it
      // does during the actual prebuild.
      const projectRoot = path.join(tmpRoot, 'apps', 'mobile');
      const hoistedDest = path.join(tmpRoot, 'node_modules', 'react-native-alarm-notification');
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.mkdirSync(path.dirname(hoistedDest), { recursive: true });
      fs.cpSync(realPackageRoot, hoistedDest, { recursive: true });

      const snapshot = () => PATCHES
        .flatMap((patch) => patch.getCandidates(projectRoot))
        .filter((candidate) => fs.existsSync(candidate))
        .sort()
        .map((candidate) => `${candidate}\n${fs.readFileSync(candidate, 'utf8')}`)
        .join('\n---\n');

      expect(() => applyPatches(projectRoot, PATCHES)).not.toThrow();
      const afterFirstRun = snapshot();

      expect(() => applyPatches(projectRoot, PATCHES)).not.toThrow();
      const afterSecondRun = snapshot();

      expect(afterSecondRun).toBe(afterFirstRun);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // The mechanism behind #1020, stated as an invariant rather than as one
  // method's spelling: under the New Architecture the interop marshals a
  // numeric argument by ObjC encoding, and only a by-value scalar ("q") gets
  // the converted integer. A pointer-typed scalar ("^q") silently receives the
  // raw double bit pattern instead, so the method runs with a garbage id and
  // reports no error. Any exported method that takes an id this way is a
  // silent no-op waiting to happen — assert none survive the patch pass.
  it('leaves no pointer-typed scalar arguments in the patched iOS module', () => {
    const realPackageRoot = path.join(__dirname, '..', '..', '..', 'node_modules', 'react-native-alarm-notification');
    if (!fs.existsSync(realPackageRoot)) return;

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alarm-patch-ptr-'));
    try {
      const projectRoot = path.join(tmpRoot, 'apps', 'mobile');
      const hoistedDest = path.join(tmpRoot, 'node_modules', 'react-native-alarm-notification');
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.mkdirSync(path.dirname(hoistedDest), { recursive: true });
      fs.cpSync(realPackageRoot, hoistedDest, { recursive: true });

      applyPatches(projectRoot, PATCHES);

      const iosSource = fs.readFileSync(path.join(hoistedDest, 'ios', 'RnAlarmNotification.m'), 'utf8');
      const pointerScalarArgs = iosSource.match(
        /RCT_EXPORT_METHOD\([^)]*\(\s*(?:NSInteger|NSUInteger|int|long|double|float|BOOL)\s*\*\s*\)/g
      ) ?? [];
      expect(pointerScalarArgs).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
