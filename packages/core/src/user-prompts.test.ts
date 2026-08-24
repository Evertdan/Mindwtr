import { describe, expect, it } from 'vitest';

import {
    comparePromptVersions,
    recordDonationPromptShown,
    recordDonationPromptSupportClicked,
    getPromptLocalDayKey,
    recordPromptActivity,
    recordStoreReviewPromptAttempt,
    recordUpdateReminderChecked,
    recordUpdateReminderDismissed,
    recordUpdateReminderShown,
    shouldCheckUpdateReminder,
    shouldShowDonationPrompt,
    shouldShowUpdateReminder,
    shouldAttemptStoreReviewPrompt,
    type UserPromptState,
} from './user-prompts';

const dayMs = 24 * 60 * 60 * 1000;
const baseMs = new Date('2026-06-01T12:00:00.000Z').getTime();

const buildEligibleState = (): UserPromptState => {
    let state: UserPromptState = {
        firstSeenAt: new Date(baseMs - 30 * dayMs).toISOString(),
    };
    for (let index = 0; index < 7; index += 1) {
        state = recordPromptActivity(state, baseMs - index * dayMs);
    }
    return state;
};

const buildDonationEligibleState = (): UserPromptState => {
    let state: UserPromptState = {
        firstSeenAt: new Date(baseMs - 45 * dayMs).toISOString(),
    };
    for (let index = 0; index < 21; index += 1) {
        state = recordPromptActivity(state, baseMs - index * dayMs);
    }
    return state;
};

const buildDonationRepeatEligibleState = (): UserPromptState => {
    let state: UserPromptState = {
        firstSeenAt: new Date(baseMs - 240 * dayMs).toISOString(),
        firstSeenDayKey: getPromptLocalDayKey(baseMs - 240 * dayMs),
        lastInterruptivePromptAt: new Date(baseMs - 183 * dayMs).toISOString(),
        donation: {
            askedEver: true,
            lastShownAt: new Date(baseMs - 183 * dayMs).toISOString(),
        },
    };
    for (let index = 0; index < 21; index += 1) {
        state = recordPromptActivity(state, baseMs - index * dayMs);
    }
    return state;
};

const buildUpdateEligibleState = (): UserPromptState => {
    let state: UserPromptState = {
        firstSeenAt: new Date(baseMs - 10 * dayMs).toISOString(),
    };
    state = recordPromptActivity(state, baseMs - dayMs);
    state = recordPromptActivity(state, baseMs - 2 * dayMs);
    return state;
};

describe('user prompt state', () => {
    it('records first seen and distinct local active days', () => {
        const first = recordPromptActivity(null, baseMs);
        const second = recordPromptActivity(first, baseMs + 60 * 60 * 1000);
        const third = recordPromptActivity(second, baseMs + dayMs);

        expect(first.firstSeenAt).toBe(new Date(baseMs).toISOString());
        expect(first.firstSeenDayKey).toBe(getPromptLocalDayKey(baseMs));
        expect(second.firstSeenAt).toBe(first.firstSeenAt);
        expect(second.firstSeenDayKey).toBe(first.firstSeenDayKey);
        expect(third.activeDayKeys).toEqual([
            getPromptLocalDayKey(baseMs),
            getPromptLocalDayKey(baseMs + dayMs),
        ]);
    });

    it('derives a stable first seen day for existing prompt state', () => {
        const firstSeenAt = new Date(baseMs - 14 * dayMs).toISOString();
        const state = recordPromptActivity({ firstSeenAt }, baseMs);

        expect(state.firstSeenAt).toBe(firstSeenAt);
        expect(state.firstSeenDayKey).toBe(getPromptLocalDayKey(baseMs - 14 * dayMs));
    });

    it('allows store review after enough usage and native availability', () => {
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: buildEligibleState(),
            storeReviewAvailable: true,
        })).toBe(true);
    });

    it('blocks store review before engagement thresholds', () => {
        const newInstall = recordPromptActivity(null, baseMs);
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs + 15 * dayMs,
            platform: 'android',
            promptState: newInstall,
            storeReviewAvailable: true,
        })).toBe(false);
    });

    it('ignores invalid and future active day keys for store review eligibility', () => {
        const state: UserPromptState = {
            firstSeenAt: new Date(baseMs - 30 * dayMs).toISOString(),
            firstSeenDayKey: getPromptLocalDayKey(baseMs - 30 * dayMs),
            activeDayKeys: [
                ...Array.from({ length: 6 }, (_, index) => getPromptLocalDayKey(baseMs - index * dayMs)),
                'not-a-day',
                getPromptLocalDayKey(baseMs + dayMs),
            ],
        };

        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: state,
            storeReviewAvailable: true,
        })).toBe(false);
    });

    it('blocks store review on unsupported platforms or unavailable native API', () => {
        const state = buildEligibleState();
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'desktop',
            promptState: state,
            storeReviewAvailable: true,
        })).toBe(false);
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: state,
            storeReviewAvailable: false,
        })).toBe(false);
    });

    it('blocks store review after recent attempts or other interruptive prompts', () => {
        const attempted = recordStoreReviewPromptAttempt(buildEligibleState(), baseMs - 10 * dayMs);
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: attempted,
            storeReviewAvailable: true,
        })).toBe(false);

        const otherPrompt: UserPromptState = {
            ...buildEligibleState(),
            lastInterruptivePromptAt: new Date(baseMs - 2 * dayMs).toISOString(),
        };
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'android',
            promptState: otherPrompt,
            storeReviewAvailable: true,
        })).toBe(false);
    });

    it('blocks store review after recent negative signals', () => {
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: buildEligibleState(),
            recentNegativeSignal: true,
            storeReviewAvailable: true,
        })).toBe(false);
    });

    it('allows donation prompt once after sustained usage on allowed channels', () => {
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: buildDonationEligibleState(),
            donationAllowed: true,
        })).toBe(true);
    });

    it('blocks donation prompt before engagement thresholds or on disallowed channels', () => {
        const newInstall = recordPromptActivity(null, baseMs);
        expect(shouldShowDonationPrompt({
            nowMs: baseMs + 31 * dayMs,
            promptState: newInstall,
            donationAllowed: true,
        })).toBe(false);
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: buildDonationEligibleState(),
            donationAllowed: false,
        })).toBe(false);
    });

    it('blocks donation prompt after it was shown or another prompt was recent', () => {
        const shown = recordDonationPromptShown(buildDonationEligibleState(), baseMs - 20 * dayMs);
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: shown,
            donationAllowed: true,
        })).toBe(false);

        const otherPrompt: UserPromptState = {
            ...buildDonationEligibleState(),
            lastInterruptivePromptAt: new Date(baseMs - 2 * dayMs).toISOString(),
        };
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: otherPrompt,
            donationAllowed: true,
        })).toBe(false);
    });

    it('allows donation prompt again after half a year and renewed active usage', () => {
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: buildDonationRepeatEligibleState(),
            donationAllowed: true,
        })).toBe(true);
    });

    it('blocks repeat donation prompt before half a year or without renewed active usage', () => {
        const tooRecent: UserPromptState = {
            ...buildDonationRepeatEligibleState(),
            lastInterruptivePromptAt: new Date(baseMs - 182 * dayMs).toISOString(),
            donation: {
                askedEver: true,
                lastShownAt: new Date(baseMs - 182 * dayMs).toISOString(),
            },
        };
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: tooRecent,
            donationAllowed: true,
        })).toBe(false);

        let inactive: UserPromptState = {
            firstSeenAt: new Date(baseMs - 240 * dayMs).toISOString(),
            firstSeenDayKey: getPromptLocalDayKey(baseMs - 240 * dayMs),
            lastInterruptivePromptAt: new Date(baseMs - 183 * dayMs).toISOString(),
            donation: {
                askedEver: true,
                lastShownAt: new Date(baseMs - 183 * dayMs).toISOString(),
            },
        };
        for (let index = 0; index < 20; index += 1) {
            inactive = recordPromptActivity(inactive, baseMs - index * dayMs);
        }
        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: inactive,
            donationAllowed: true,
        })).toBe(false);
    });

    it('blocks donation prompt for a year after support action click', () => {
        let state = recordDonationPromptShown(buildDonationEligibleState(), baseMs - 366 * dayMs);
        state = recordDonationPromptSupportClicked(state, baseMs - 364 * dayMs);
        for (let index = 0; index < 21; index += 1) {
            state = recordPromptActivity(state, baseMs - index * dayMs);
        }

        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: state,
            donationAllowed: true,
        })).toBe(false);
    });

    it('allows donation prompt after support click cooldown and renewed active usage', () => {
        let state = recordDonationPromptShown(buildDonationEligibleState(), baseMs - 370 * dayMs);
        state = recordDonationPromptSupportClicked(state, baseMs - 366 * dayMs);
        for (let index = 0; index < 21; index += 1) {
            state = recordPromptActivity(state, baseMs - index * dayMs);
        }

        expect(shouldShowDonationPrompt({
            nowMs: baseMs,
            promptState: state,
            donationAllowed: true,
        })).toBe(true);
    });

    it('records donation prompt display metadata when shown', () => {
        const state = recordDonationPromptShown(buildDonationEligibleState(), baseMs);
        expect(state.donation?.askedEver).toBe(true);
        expect(state.donation?.lastShownAt).toBe(new Date(baseMs).toISOString());
        expect(state.lastInterruptivePromptAt).toBe(new Date(baseMs).toISOString());
    });

    it('records donation support action click metadata', () => {
        const state = recordDonationPromptSupportClicked(buildDonationEligibleState(), baseMs);
        expect(state.donation?.lastActionAt).toBe(new Date(baseMs).toISOString());
    });

    it('compares prompt versions with optional v prefixes', () => {
        expect(comparePromptVersions('0.9.8', '0.9.9')).toBe(-1);
        expect(comparePromptVersions('v1.0.0', '0.9.9')).toBe(1);
        expect(comparePromptVersions('1.0', '1.0.0')).toBe(0);
    });

    it('checks update reminders at most daily on allowed channels', () => {
        const checked = recordUpdateReminderChecked(buildEligibleState(), baseMs - 2 * 60 * 60 * 1000);
        expect(shouldCheckUpdateReminder({
            nowMs: baseMs,
            promptState: checked,
            updateReminderAllowed: true,
        })).toBe(false);
        expect(shouldCheckUpdateReminder({
            nowMs: baseMs + dayMs,
            promptState: checked,
            updateReminderAllowed: true,
        })).toBe(true);
        expect(shouldCheckUpdateReminder({
            nowMs: baseMs + dayMs,
            promptState: checked,
            updateReminderAllowed: false,
        })).toBe(false);
    });

    it('shows update reminders when meaningfully behind and not dismissed for that version', () => {
        const state = buildUpdateEligibleState();
        expect(shouldShowUpdateReminder({
            nowMs: baseMs,
            promptState: state,
            updateReminderAllowed: true,
            currentVersion: '0.9.8',
            latestVersion: '0.10.0',
            latestReleasedAt: new Date(baseMs - dayMs).toISOString(),
        })).toBe(true);
    });

    it('blocks update reminders for fresh patch releases, dismissed versions, and recent prompts', () => {
        const state = buildUpdateEligibleState();
        expect(shouldShowUpdateReminder({
            nowMs: baseMs,
            promptState: state,
            updateReminderAllowed: true,
            currentVersion: '0.9.8',
            latestVersion: '0.9.9',
            latestReleasedAt: new Date(baseMs - 3 * dayMs).toISOString(),
        })).toBe(false);

        const dismissed = recordUpdateReminderDismissed(state, '0.10.0');
        expect(shouldShowUpdateReminder({
            nowMs: baseMs,
            promptState: dismissed,
            updateReminderAllowed: true,
            currentVersion: '0.9.8',
            latestVersion: '0.10.0',
            latestReleasedAt: new Date(baseMs - dayMs).toISOString(),
        })).toBe(false);

        const shown = recordUpdateReminderShown(state, baseMs - 2 * dayMs);
        expect(shouldShowUpdateReminder({
            nowMs: baseMs,
            promptState: shown,
            updateReminderAllowed: true,
            currentVersion: '0.9.8',
            latestVersion: '0.10.0',
            latestReleasedAt: new Date(baseMs - dayMs).toISOString(),
        })).toBe(false);
    });
});
