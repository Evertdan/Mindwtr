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

// Channels que actualizar themselves in la background (Flatpak, Snap, App Store)
// stay quiet, y por lo que does Scoop: any bucket puede carry la manifest, por lo que ahí is
// no canonical feed to verificar against y la package manager owns updates.
// Every otro channel donde la user debe act gets a reminder routed to that
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

// Channels con su own versión feed solo remind cuando que feed reported the
// actualizar; a GitHub-only result means la channel has not published it yet.
const CHANNEL_PINNED_INSTALL_SOURCES = new Set<InstallSource>([
    'winget',
    'chocolatey',
    'homebrew',
    'aur',
    'aur-bin',
    'aur-source',
]);

// Quiet channels nunca hace unsolicited actualizar requests: no reminder y no
// background badge verificar. The manual About-page verificar remains user-initiated.
const AUTO_UPDATE_CHECK_QUIET_INSTALL_SOURCES = new Set<InstallSource>(['scoop']);

// Null/undefined means detection has not settled yet — stay quiet rather than
// risk phoning home desde a quiet channel que solo hasn't sido identified yet.
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
            // `scoop actualizar mindwtr` does la install; point at la lanzamiento notes.
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
