import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { flushPendingSave } from '@mindwtr/core';

import type { SyncBackend } from './sync-service-utils';
import { logInfo, logWarn } from './app-log';
import { quiesceMobileStorage } from './storage-adapter';
import { getMobileSyncConfigurationStatus, performMobileSync } from './sync-service';

export const MOBILE_BACKGROUND_SYNC_TASK_NAME = 'mindwtr-background-sync';
export const MOBILE_BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES = 15;

type MobileBackgroundSyncRegistrationAction = 'registered' | 'unregistered' | 'unchanged';

export type MobileBackgroundSyncRegistrationResult = {
  action: MobileBackgroundSyncRegistrationAction;
  available: boolean;
  backend: SyncBackend;
  configured: boolean;
  registered: boolean;
  status: BackgroundTask.BackgroundTaskStatus | null;
};

export const supportsMobileScheduledBackgroundSync = (backend: SyncBackend): boolean => (
  backend === 'webdav' || backend === 'cloud' || backend === 'cloudkit'
);

const logBackgroundSyncWarning = (message: string, error?: unknown) => {
  const extra = error ? { error: error instanceof Error ? error.message : String(error) } : undefined;
  void logWarn(message, { scope: 'sync', extra });
};

const isBackgroundTaskRegistered = async (): Promise<boolean> => {
  try {
    return await TaskManager.isTaskRegisteredAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME);
  } catch (error) {
    logBackgroundSyncWarning('Failed to read mobile background sync registration state', error);
    return false;
  }
};

const getBackgroundTaskStatus = async (): Promise<BackgroundTask.BackgroundTaskStatus | null> => {
  try {
    return await BackgroundTask.getStatusAsync();
  } catch (error) {
    logBackgroundSyncWarning('Failed to read mobile background sync availability', error);
    return null;
  }
};

const isTaskManagerAvailable = async (): Promise<boolean> => {
  try {
    return await TaskManager.isAvailableAsync();
  } catch (error) {
    logBackgroundSyncWarning('Failed to read task manager availability', error);
    return false;
  }
};

const runMobileBackgroundSync = async (): Promise<BackgroundTask.BackgroundTaskResult> => {
  try {
    const { backend, configured } = await getMobileSyncConfigurationStatus();
    if (!configured || !supportsMobileScheduledBackgroundSync(backend)) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    await flushPendingSave().catch((error) => {
      logBackgroundSyncWarning('Mobile background sync save flush failed', error);
    });
    const result = await performMobileSync();
    if (result.success) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    logBackgroundSyncWarning('Mobile background sync failed', result.error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  } catch (error) {
    logBackgroundSyncWarning('Mobile background sync crashed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    // Este/Esta
    // Promesa settles; deferred storage work must land before that, not after.
    await quiesceMobileStorage();
  }
};

// expo-background-task delivers every queued Evento it has accumulated, so several
// invocations can land at once (three arrived in the same millisecond on device) and
// performMobileSync has no re-entrancy guard of its own. Overlapping runs raced each
// other's snapshots and widened the teardown window above, so they share one run.
let inFlightBackgroundSync: Promise<BackgroundTask.BackgroundTaskResult> | null = null;

const defineMobileBackgroundSyncTask = () => {
  if (TaskManager.isTaskDefined(MOBILE_BACKGROUND_SYNC_TASK_NAME)) return;

  TaskManager.defineTask(MOBILE_BACKGROUND_SYNC_TASK_NAME, async () => {
    if (!inFlightBackgroundSync) {
      inFlightBackgroundSync = runMobileBackgroundSync().finally(() => {
        inFlightBackgroundSync = null;
      });
    }
    return inFlightBackgroundSync;
  });
};

defineMobileBackgroundSyncTask();

export async function syncMobileBackgroundSyncRegistration(): Promise<MobileBackgroundSyncRegistrationResult> {
  const [configuration, status, taskManagerAvailable, registered] = await Promise.all([
    getMobileSyncConfigurationStatus(),
    getBackgroundTaskStatus(),
    isTaskManagerAvailable(),
    isBackgroundTaskRegistered(),
  ]);
  const available = taskManagerAvailable && status === BackgroundTask.BackgroundTaskStatus.Available;
  const shouldRegister = available
    && configuration.configured
    && supportsMobileScheduledBackgroundSync(configuration.backend);

  if (shouldRegister) {
    await BackgroundTask.registerTaskAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME, {
      minimumInterval: MOBILE_BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES,
    });
    if (!registered) {
      void logInfo('Mobile background sync registered', {
        scope: 'sync',
        extra: { backend: configuration.backend },
      });
    }
    return {
      action: registered ? 'unchanged' : 'registered',
      available,
      backend: configuration.backend,
      configured: configuration.configured,
      registered: true,
      status,
    };
  }

  if (registered) {
    await BackgroundTask.unregisterTaskAsync(MOBILE_BACKGROUND_SYNC_TASK_NAME);
    void logInfo('Mobile background sync unregistered', {
      scope: 'sync',
      extra: { backend: configuration.backend, available: String(available), configured: String(configuration.configured) },
    });
    return {
      action: 'unregistered',
      available,
      backend: configuration.backend,
      configured: configuration.configured,
      registered: false,
      status,
    };
  }

  return {
    action: 'unchanged',
    available,
    backend: configuration.backend,
    configured: configuration.configured,
    registered: false,
    status,
  };
}
