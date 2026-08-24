import type { SyncBackend } from '@mindwtr/core';

export const MINDWTR_DESKTOP_ONBOARDING_EVENT = 'mindwtr:desktop-onboarding';
const DESKTOP_ONBOARDING_HANDOFF_HINT_KEY_PREFIX = 'mindwtr:desktop:onboarding-handoff-hint:v1:';

export type DesktopOnboardingHandoffPage = 'sync' | 'data';

/**
 * Dismissible onboarding hints, keyed by where they appear. The settings pages
 * are handoff targets from the first-run modal; 'inbox-project' is the Inbox
 * tip that points at the multi-step decision inside Process Inbox (#592).
 */
export type DesktopOnboardingHint = DesktopOnboardingHandoffPage | 'inbox-project';

type DesktopFirstRunOnboardingState = {
    hasHydratedSettings: boolean;
    isLoading: boolean;
    dismissed: boolean;
    visibleDataCount: number;
    syncBackend: SyncBackend;
};

export function shouldOpenDesktopFirstRunOnboarding({
    hasHydratedSettings,
    isLoading,
    dismissed,
    visibleDataCount,
    syncBackend,
}: DesktopFirstRunOnboardingState): boolean {
    return hasHydratedSettings
        && !isLoading
        && !dismissed
        && visibleDataCount === 0
        && syncBackend === 'off';
}

export function dispatchDesktopOnboardingEvent(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MINDWTR_DESKTOP_ONBOARDING_EVENT));
}

export function subscribeDesktopOnboardingEvent(handler: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => undefined;
    }

    const listener: EventListener = () => handler();
    window.addEventListener(MINDWTR_DESKTOP_ONBOARDING_EVENT, listener);
    return () => window.removeEventListener(MINDWTR_DESKTOP_ONBOARDING_EVENT, listener);
}

function getDesktopOnboardingHintKey(hint: DesktopOnboardingHint): string {
    return `${DESKTOP_ONBOARDING_HANDOFF_HINT_KEY_PREFIX}${hint}`;
}

export function isDesktopOnboardingHintDismissed(hint: DesktopOnboardingHint): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(getDesktopOnboardingHintKey(hint)) === 'dismissed';
    } catch {
        return false;
    }
}

/**
 * The Inbox tip retires itself once the user has a project: by then they have
 * found the multi-step decision, and a hint that keeps showing is nagging.
 */
export function shouldShowInboxProjectHint(dismissed: boolean, projectCount: number): boolean {
    return !dismissed && projectCount === 0;
}

export function dismissDesktopOnboardingHint(hint: DesktopOnboardingHint): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(getDesktopOnboardingHintKey(hint), 'dismissed');
    } catch {
        // Onboarding hints are convenience UI; storage failures no debería block the settings page.
    }
}
