import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cloudRequestJson, getCloudBaseUrl } from '@mindwtr/core';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { getMobileCloudRequestOptions } from '@/lib/webdav-request-options';
import type { TdahPermissionsSnapshot } from '@/lib/tdah-permissions';
import { isTdahPermissionDegraded } from '@/lib/tdah-permissions';

import { TdahOnboardingStepPromise } from './tdah-onboarding-step-promise';
import { TdahOnboardingStepRitual } from './tdah-onboarding-step-ritual';
import { TdahOnboardingStepRoutine, TDAH_SUGGESTED_WEEKDAY_BLOCKS, TDAH_SUGGESTED_WEEKDAY_ROUTINE_TITLE } from './tdah-onboarding-step-routine';
import { TdahOnboardingStepPermissions } from './tdah-onboarding-step-permissions';
import { TdahOnboardingPermissionNotice } from './tdah-onboarding-permission-notice';
import { TdahOnboardingStepDone } from './tdah-onboarding-step-done';
import { styles } from './tdah-onboarding.styles';
import type {
    TdahActivateResult,
    TdahActivateStatus,
    TdahOnboardingCloudConfig,
    TdahOnboardingRoutineChoice,
    TdahOnboardingStep,
    TdahOnboardingVariant,
    TdahRoutineDraft,
} from './tdah-onboarding-types';

const TDAH_ACTIVATE_PATH = '/tdah/activate';
const TDAH_ACTIVATE_TIMEOUT_MS = 15_000;
const DEFAULT_RITUAL_HOUR = '23:00';

function buildTdahActivateUrl(cloudUrl: string): string {
    return `${getCloudBaseUrl(cloudUrl)}${TDAH_ACTIVATE_PATH}`;
}

function buildTdahActivateOptions(cloud: TdahOnboardingCloudConfig) {
    return {
        ...getMobileCloudRequestOptions(cloud.allowInsecureHttp),
        token: cloud.token,
        timeoutMs: TDAH_ACTIVATE_TIMEOUT_MS,
    };
}

/**
 * T-14 onboarding container (story 1.3). Full 5-step flow for the first-ever
 * activation, or a `reactivation` shortcut that skips straight to step 5 and
 * calls `/activate` with an empty body (tz/ritualHour are already conserved
 * server-side — spec Boundaries). Nothing in step 4's permissions can block
 * reaching step 5; `POST /activate` is the only source of truth for the
 * result step 5 shows (never fabricated client-side).
 */
export type TdahOnboardingFlowProps = {
    cloud: TdahOnboardingCloudConfig;
    variant: TdahOnboardingVariant;
    initialTimeZone: string;
    onFinished: (result: TdahActivateResult) => void;
    onClose: () => void;
};

export function TdahOnboardingFlow({ cloud, variant, initialTimeZone, onFinished, onClose }: TdahOnboardingFlowProps) {
    const tc = useThemeColors();

    const [step, setStep] = useState<TdahOnboardingStep>(variant === 'reactivation' ? 'done' : 'promise');
    const [timeZone, setTimeZone] = useState(initialTimeZone);
    const [ritualHour, setRitualHour] = useState(DEFAULT_RITUAL_HOUR);
    const [routineChoice, setRoutineChoice] = useState<TdahOnboardingRoutineChoice>(null);
    const [permissions, setPermissions] = useState<TdahPermissionsSnapshot | null>(null);
    const [activateStatus, setActivateStatus] = useState<TdahActivateStatus>('idle');
    const [activateResult, setActivateResult] = useState<TdahActivateResult | null>(null);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const routineDraft = useMemo((): TdahRoutineDraft | undefined => {
        if (variant !== 'full' || routineChoice !== 'create') return undefined;
        return { title: TDAH_SUGGESTED_WEEKDAY_ROUTINE_TITLE, blocks: TDAH_SUGGESTED_WEEKDAY_BLOCKS };
    }, [routineChoice, variant]);

    const performActivate = useCallback(async () => {
        setActivateStatus('pending');
        try {
            const body = variant === 'reactivation'
                ? {}
                : { timeZone, ritualHour, ...(routineDraft ? { routine: routineDraft } : {}) };
            const result = await cloudRequestJson<TdahActivateResult>(
                'POST',
                buildTdahActivateUrl(cloud.url),
                body,
                buildTdahActivateOptions(cloud),
            );
            if (!mountedRef.current) return;
            if (!result) {
                setActivateStatus('error');
                return;
            }
            setActivateResult(result);
            setActivateStatus('success');
            onFinished(result);
        } catch {
            if (!mountedRef.current) return;
            setActivateStatus('error');
        }
    }, [cloud, onFinished, ritualHour, routineDraft, timeZone, variant]);

    useEffect(() => {
        if (step !== 'done' || activateStatus !== 'idle') return;
        void performActivate();
    }, [activateStatus, performActivate, step]);

    const handlePermissionsContinue = useCallback((snapshot: TdahPermissionsSnapshot) => {
        setPermissions(snapshot);
        setStep(isTdahPermissionDegraded(snapshot) ? 'permission-notice' : 'done');
    }, []);

    const handleRetryActivate = useCallback(() => {
        setActivateStatus('idle');
    }, []);

    return (
        <Modal animationType="slide" onRequestClose={onClose} testID="tdah-onboarding-modal" visible>
            <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: tc.bg }]}>
                {step === 'promise' ? (
                    <TdahOnboardingStepPromise onClose={onClose} onNext={() => setStep('ritual')} />
                ) : null}
                {step === 'ritual' ? (
                    <TdahOnboardingStepRitual
                        onBack={() => setStep('promise')}
                        onChangeRitualHour={setRitualHour}
                        onChangeTimeZone={setTimeZone}
                        onNext={() => setStep('routine')}
                        ritualHour={ritualHour}
                        timeZone={timeZone}
                    />
                ) : null}
                {step === 'routine' ? (
                    <TdahOnboardingStepRoutine
                        onBack={() => setStep('ritual')}
                        onCreate={() => {
                            setRoutineChoice('create');
                            setStep('permissions');
                        }}
                        onSkip={() => {
                            setRoutineChoice('skip');
                            setStep('permissions');
                        }}
                    />
                ) : null}
                {step === 'permissions' ? (
                    <TdahOnboardingStepPermissions onBack={() => setStep('routine')} onContinue={handlePermissionsContinue} />
                ) : null}
                {step === 'permission-notice' ? (
                    <TdahOnboardingPermissionNotice
                        onBack={() => setStep('permissions')}
                        onContinue={() => setStep('done')}
                        permissions={permissions}
                    />
                ) : null}
                {step === 'done' ? (
                    <TdahOnboardingStepDone
                        onClose={onClose}
                        onDone={onClose}
                        onRetry={handleRetryActivate}
                        result={activateResult}
                        status={activateStatus}
                        variant={variant}
                    />
                ) : null}
            </SafeAreaView>
        </Modal>
    );
}
