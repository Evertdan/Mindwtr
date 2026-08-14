const fs = require('fs');
const path = require('path');
const { createRunOncePlugin, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

// Self-hosted sync behind a private CA: Android apps trust ONLY system CAs by
// default (target SDK 24+), so a CA the user installed on the device is
// invisible to the app and the TLS handshake fails — surfaced as the
// misleading "Self-hosted URL not configured" after the setup gate rolls the
// config back (#663). Trusting `src="user"` restores parity with desktop,
// where the OS certificate store (which admins can extend) is honored.
// Installing a user CA is a deliberate, device-owner action that Android
// itself flags persistently, so this does not silently widen the trust base.
const RESOURCE_DIR = path.join('android', 'app', 'src', 'main', 'res', 'xml');
const CONFIG_FILE_NAME = 'network_security_config.xml';
const MANIFEST_ATTRIBUTE = '@xml/network_security_config';

// cleartextTrafficPermitted mirrors the manifest usesCleartextTraffic="true"
// this config REPLACES (a networkSecurityConfig overrides that attribute) —
// dropping it would silently break WebDAV sync to localhost/private IPs,
// which app code already restricts HTTP to.
const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

const writeNetworkSecurityConfigResource = (projectRoot) => {
  const xmlDir = path.join(projectRoot, RESOURCE_DIR);
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.writeFileSync(path.join(xmlDir, CONFIG_FILE_NAME), NETWORK_SECURITY_CONFIG_XML);
};

const setNetworkSecurityConfigAttribute = (manifest) => {
  const application = manifest.manifest.application?.[0];
  if (!application) return manifest;
  if (!application.$) application.$ = {};
  application.$['android:networkSecurityConfig'] = MANIFEST_ATTRIBUTE;
  return manifest;
};

const withAndroidNetworkSecurityConfig = (config) => {
  const withResource = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      writeNetworkSecurityConfigResource(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);
  return withAndroidManifest(withResource, (modConfig) => {
    setNetworkSecurityConfigAttribute(modConfig.modResults);
    return modConfig;
  });
};

module.exports = createRunOncePlugin(
  withAndroidNetworkSecurityConfig,
  'mindwtr-android-network-security-config',
  '1.0.0',
);

module.exports.__testables = {
  CONFIG_FILE_NAME,
  MANIFEST_ATTRIBUTE,
  NETWORK_SECURITY_CONFIG_XML,
  RESOURCE_DIR,
  setNetworkSecurityConfigAttribute,
  writeNetworkSecurityConfigResource,
};
