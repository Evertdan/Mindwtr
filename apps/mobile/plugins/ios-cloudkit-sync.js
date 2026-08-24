const {
  withEntitlementsPlist,
  withInfoPlist,
  withPlugins,
} = require('@expo/config-plugins');

const CLOUDKIT_CONTAINER = 'iCloud.tech.dongdongbh.mindwtr';

/**
 * Add iCloud/CloudKit entitlements so the app can use CKContainer
 * with the private database for sync.
 */
const withCloudKitEntitlements = (config) => {
  return withEntitlementsPlist(config, (mod) => {
    const entitlements = mod.modResults;

    // Habilitar servicios CloudKit (no clave-valor ni documentos)
    entitlements['com.apple.developer.icloud-services'] = ['CloudKit'];

    // Registrar nuestro identificador de contenedor
    const containers = entitlements['com.apple.developer.icloud-container-identifiers'] ?? [];
    if (!containers.includes(CLOUDKIT_CONTAINER)) {
      containers.push(CLOUDKIT_CONTAINER);
    }
    entitlements['com.apple.developer.icloud-container-identifiers'] = containers;

    // Entorno APS para notificaciones push silenciosas (suscripciones de zona)
    if (!entitlements['aps-environment']) {
      entitlements['aps-environment'] = 'production';
    }

    return mod;
  });
};

/**
 * Add remote-notification background mode so the app wakes on
 * CloudKit zone subscription pushes.
 */
const withRemoteNotificationBackground = (config) => {
  return withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    const modes = plist.UIBackgroundModes ?? [];
    if (!modes.includes('remote-notification')) {
      modes.push('remote-notification');
    }
    plist.UIBackgroundModes = modes;
    return mod;
  });
};

const withCloudKitSync = (config) => {
  return withPlugins(config, [
    withCloudKitEntitlements,
    withRemoteNotificationBackground,
  ]);
};

module.exports = withCloudKitSync;
