import { describe, expect, it } from 'vitest';

const plugin = require('./android-persistent-connection-service');

const {
  ensurePersistentConnectionPermissions,
  ensurePersistentConnectionService,
  REQUIRED_PERMISSIONS,
  SERVICE_NAME,
} = plugin.__testables;

describe('android-persistent-connection-service', () => {
  it('adds FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC, and battery exemption permissions idempotently', () => {
    const androidManifest = { manifest: {} };

    ensurePersistentConnectionPermissions(androidManifest);
    const once = JSON.stringify(androidManifest);
    ensurePersistentConnectionPermissions(androidManifest);

    expect(JSON.stringify(androidManifest)).toBe(once);
    const names = androidManifest.manifest['uses-permission'].map((permission) => permission.$['android:name']);
    REQUIRED_PERMISSIONS.forEach((permissionName) => {
      expect(names).toContain(permissionName);
    });
    expect(androidManifest.manifest['uses-permission']).toHaveLength(REQUIRED_PERMISSIONS.length);
  });

  it('declares the foreground service with the dataSync type and idempotently, never exported', () => {
    const application = { service: [] };

    ensurePersistentConnectionService(application);
    const once = JSON.stringify(application);
    ensurePersistentConnectionService(application);

    expect(JSON.stringify(application)).toBe(once);
    expect(application.service).toHaveLength(1);
    expect(application.service[0]).toEqual({
      $: {
        'android:name': SERVICE_NAME,
        'android:exported': 'false',
        'android:foregroundServiceType': 'dataSync',
      },
    });
  });

  it('preserves other permissions and services already present in the manifest', () => {
    const androidManifest = {
      manifest: {
        'uses-permission': [{ $: { 'android:name': 'android.permission.CAMERA' } }],
        application: [{ service: [{ $: { 'android:name': '.quicksettings.CaptureTileService' } }] }],
      },
    };

    ensurePersistentConnectionPermissions(androidManifest);
    ensurePersistentConnectionService(androidManifest.manifest.application[0]);

    const permissionNames = androidManifest.manifest['uses-permission'].map((permission) => permission.$['android:name']);
    expect(permissionNames).toContain('android.permission.CAMERA');
    expect(androidManifest.manifest.application[0].service.map((service) => service.$['android:name'])).toEqual([
      '.quicksettings.CaptureTileService',
      SERVICE_NAME,
    ]);
  });
});
