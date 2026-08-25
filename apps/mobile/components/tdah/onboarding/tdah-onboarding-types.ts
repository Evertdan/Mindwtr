/**
 * Wire-facing shapes for the T-14 onboarding flow (story 1.3). Mirrors the
 * `POST /v1/tdah/activate` contract by hand rather than importing the
 * server's `apps/cloud/src/tdah/types.ts` (ADR 0026: clients talk to the
 * HTTP surface, never to server-only types across the wire boundary).
 */

export type TdahOnboardingCloudConfig = {
    url: string;
    token: string;
    allowInsecureHttp: boolean;
};

export type TdahOnboardingVariant = 'full' | 'reactivation';

export type TdahRoutineBlockDraft = {
    title: string;
    startTime: string;
    durationMinutes: number;
};

export type TdahRoutineDraft = {
    title: string;
    blocks: TdahRoutineBlockDraft[];
};

export type TdahActivateProfile = {
    mode: 'on' | 'off';
    timeZone: string;
    ritualHour: string;
};

export type TdahActivateResult = {
    profile: TdahActivateProfile;
    routineCreated: boolean;
    dayPlan: {
        date: string;
        activityCount: number;
    };
};

export type TdahOnboardingStep =
    | 'promise'
    | 'ritual'
    | 'routine'
    | 'permissions'
    | 'permission-notice'
    | 'done';

export type TdahOnboardingRoutineChoice = 'create' | 'skip' | null;

export type TdahActivateStatus = 'idle' | 'pending' | 'success' | 'error';
