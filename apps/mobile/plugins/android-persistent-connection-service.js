const { withAndroidManifest } = require('@expo/config-plugins');

// Fully qualified: this class lives in the persistent-connection Expo module
// (apps/mobile/modules/persistent-connection), not the app's own package, so
// the manifest-relative `.ServiceName` shorthand doesn't resolve — same
// reasoning as android-manifest-fixes.js's context-automation service entry.
const SERVICE_NAME = 'tech.dongdongbh.mindwtr.persistentconnection.PersistentConnectionForegroundService';
const FOREGROUND_SERVICE_TYPE = 'dataSync';

const REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  // Needed to read/request the exemption behind the story's "conexión
  // limitada por batería" chip (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

const ensureArray = (target, key) => {
  if (!Array.isArray(target[key])) {
    target[key] = [];
  }
  return target[key];
};

const ensurePersistentConnectionPermissions = (androidManifest) => {
  const permissions = ensureArray(androidManifest.manifest, 'uses-permission');
  REQUIRED_PERMISSIONS.forEach((permissionName) => {
    const exists = permissions.some((permission) => permission?.$?.['android:name'] === permissionName);
    if (!exists) {
      permissions.push({ $: { 'android:name': permissionName } });
    }
  });
  return androidManifest;
};

const ensurePersistentConnectionService = (application) => {
  const services = ensureArray(application, 'service');
  let service = services.find((entry) => entry?.$?.['android:name'] === SERVICE_NAME);
  if (!service) {
    service = { $: {} };
    services.push(service);
  }

  service.$['android:name'] = SERVICE_NAME;
  service.$['android:exported'] = 'false';
  service.$['android:foregroundServiceType'] = FOREGROUND_SERVICE_TYPE;
  return service;
};

// Declares N-05's foreground service + the permissions its story needs
// (spec Always: "nunca editando a mano el árbol nativo generado por expo
// prebuild") — parallels android-manifest-fixes.js's own service/permission
// injection pattern.
module.exports = function withAndroidPersistentConnectionService(config) {
  return withAndroidManifest(config, (cfg) => {
    const androidManifest = cfg.modResults;
    ensurePersistentConnectionPermissions(androidManifest);

    const application = androidManifest.manifest.application?.[0];
    if (!application) return cfg;

    ensurePersistentConnectionService(application);
    return cfg;
  });
};

module.exports.__testables = {
  ensurePersistentConnectionPermissions,
  ensurePersistentConnectionService,
  SERVICE_NAME,
  REQUIRED_PERMISSIONS,
};
