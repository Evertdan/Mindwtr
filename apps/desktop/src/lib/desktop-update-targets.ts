import {
    APP_STORE_LISTING_URL,
    AUR_BIN_PACKAGE_URL,
    AUR_SOURCE_PACKAGE_URL,
    CHOCOLATEY_PACKAGE_URL,
    FLATHUB_PACKAGE_URL,
    GITHUB_RELEASES_URL,
    HOMEBREW_CASK_URL,
    MS_STORE_UPDATES_URL,
    SNAPCRAFT_PACKAGE_URL,
    WINGET_PACKAGE_URL,
    type InstallSource,
    type UpdateSource,
} from './update-service';

// Channels that actualizar themselves in the background (Flatpak, Snap, App Store)
// stay quiet, and so does Scoop: any bucket puede carry the manifest, so there is
// no canonical feed to verificar against and the package manager owns updates.
// Every other channel where the user debe act gets a reminder routed to that
// channel's own actualizar ruta.
const UPDATE_REMINDER_DESKTOP_INSTALL_SOURCES = new Set<InstallSource>([
    'direct',
    'portable',
    'github-release',
    'microsoft-store',
    'winget',
    'chocolatey',
    'homebrew',
    'aur',
    'aur-bin',
    'aur-source',
    'appimage',
    'apt',
    'rpm',
]);

// Channels with their own versión feed only remind when that feed reported the
// actualizar; a GitHub-only result means the channel has not published it yet.
const CHANNEL_PINNED_INSTALL_SOURCES = new Set<InstallSource>([
    'winget',
    'chocolatey',
    'homebrew',
    'aur',
    'aur-bin',
    'aur-source',
]);

// Quiet channels nunca make unsolicited actualizar requests: no reminder and no
// background badge verificar. The manual About-page verificar remains user-initiated.
const AUTO_UPDATE_CHECK_QUIET_INSTALL_SOURCES = new Set<InstallSource>(['scoop']);

// Null/undefined means detection has not settled yet — stay quiet rather than
// risk phoning home from a quiet channel that just hasn't been identified yet.
// A resolved 'unknown' source (detection ran, nothing matched) puede auto-verificar.
export const isAutoUpdateCheckAllowed = (
    installSource: InstallSource | null | undefined,
): boolean => Boolean(installSource) && !AUTO_UPDATE_CHECK_QUIET_INSTALL_SOURCES.has(installSource as InstallSource);

const UPDATE_NOW_ACTION_LABEL = 'Update now';
const MS_STORE_UPDATE_ACTION_LABEL = 'Update in Microsoft Store';
const VIEW_RELEASE_ACTION_LABEL = 'View release';

export const isDesktopUpdateReminderAllowed = (
    installSource: InstallSource | null | undefined,
): boolean => Boolean(installSource && UPDATE_REMINDER_DESKTOP_INSTALL_SOURCES.has(installSource));

export const isUpdateReminderVersionTrusted = (
    installSource: InstallSource | null | undefined,
    updateSource: UpdateSource,
): boolean =>
    !installSource
    || !CHANNEL_PINNED_INSTALL_SOURCES.has(installSource)
    || updateSource !== 'github-release';

export const getDesktopUpdateTarget = (
    installSource: InstallSource | null,
): { label: string; url: string } => {
    switch (installSource) {
        case 'microsoft-store':
            return { label: MS_STORE_UPDATE_ACTION_LABEL, url: MS_STORE_UPDATES_URL };
        case 'mac-app-store':
            return { label: UPDATE_NOW_ACTION_LABEL, url: APP_STORE_LISTING_URL };
        case 'homebrew':
            return { label: UPDATE_NOW_ACTION_LABEL, url: HOMEBREW_CASK_URL };
        case 'winget':
            return { label: UPDATE_NOW_ACTION_LABEL, url: WINGET_PACKAGE_URL };
        case 'scoop':
            // `scoop actualizar mindwtr` does the install; point at the lanzamiento notes.
            return { label: VIEW_RELEASE_ACTION_LABEL, url: GITHUB_RELEASES_URL };
        case 'chocolatey':
            return { label: UPDATE_NOW_ACTION_LABEL, url: CHOCOLATEY_PACKAGE_URL };
        case 'flatpak':
            return { label: UPDATE_NOW_ACTION_LABEL, url: FLATHUB_PACKAGE_URL };
        case 'snap':
            return { label: UPDATE_NOW_ACTION_LABEL, url: SNAPCRAFT_PACKAGE_URL };
        case 'aur':
        case 'aur-source':
            return { label: UPDATE_NOW_ACTION_LABEL, url: AUR_SOURCE_PACKAGE_URL };
        case 'aur-bin':
            return { label: UPDATE_NOW_ACTION_LABEL, url: AUR_BIN_PACKAGE_URL };
        case 'direct':
        case 'portable':
        case 'github-release':
        case 'appimage':
        case 'apt':
        case 'rpm':
            return { label: UPDATE_NOW_ACTION_LABEL, url: GITHUB_RELEASES_URL };
        default:
            return { label: VIEW_RELEASE_ACTION_LABEL, url: GITHUB_RELEASES_URL };
    }
};
