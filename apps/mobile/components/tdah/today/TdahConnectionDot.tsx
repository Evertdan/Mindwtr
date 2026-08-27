import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Circle, CircleDashed } from 'lucide-react-native';

import { tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

import type { TdahConnectionStatus } from '@/lib/persistent-connection';

export type TdahConnectionDotProps = {
    status: TdahConnectionStatus;
    /** true once the battery-exemption permission is confirmed missing (never true while unknown/iOS). */
    batteryLimited: boolean;
    onRequestBatteryExemption: () => void;
};

const DOT_SIZE = 14;

/**
 * `connection-dot` (DESIGN.md §Components, N-05 / T-01): 3 visual states —
 * `●` conectado (success, discreto), `◍` reconectando (outlineVariant, sin
 * animación agresiva), `○` sin servidor (error). Tap opens an inline
 * explanation + battery-exemption access — EXPERIENCE.md's own rule: "Nunca
 * genera modal por sí solo", so this expands in place rather than rendering
 * `<Modal>`.
 */
export function TdahConnectionDot({ status, batteryLimited, onRequestBatteryExemption }: TdahConnectionDotProps) {
    const tc = useThemeColors();
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(false);

    const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

    // ThemeColors has no dedicated "outlineVariant" token; `tc.border` (M3
    // `outline`) is the closest existing neutral for the reconnecting glyph.
    const dotColor = status === 'connected' ? tc.success : status === 'offline' ? tc.danger : tc.border;
    const statusLabel = tFallback(
        t,
        status === 'connected'
            ? 'tdahToday.connectionDotConnected'
            : status === 'offline'
                ? 'tdahToday.connectionDotOffline'
                : 'tdahToday.connectionDotReconnecting',
        status === 'connected' ? 'Connected' : status === 'offline' ? 'No server connection' : 'Reconnecting…',
    );

    return (
        <View style={styles.container} testID="tdah-connection-dot">
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={statusLabel}
                accessibilityState={{ expanded }}
                onPress={toggleExpanded}
                style={styles.tapTarget}
                testID="tdah-connection-dot-glyph"
            >
                {status === 'reconnecting' ? (
                    <CircleDashed size={DOT_SIZE} color={dotColor} strokeWidth={2} testID="tdah-connection-dot-reconnecting" />
                ) : (
                    <Circle
                        size={DOT_SIZE}
                        color={dotColor}
                        fill={status === 'connected' ? dotColor : 'none'}
                        strokeWidth={2}
                        testID={status === 'connected' ? 'tdah-connection-dot-connected' : 'tdah-connection-dot-offline'}
                    />
                )}
                {batteryLimited ? (
                    <View style={[styles.batteryChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]} testID="tdah-connection-battery-chip">
                        <Text style={[styles.batteryChipText, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahToday.connectionBatteryChip', 'Connection limited by battery')}
                        </Text>
                    </View>
                ) : null}
            </TouchableOpacity>

            {expanded ? (
                <View style={[styles.explanation, { borderColor: tc.border, backgroundColor: tc.filterBg }]} testID="tdah-connection-explanation">
                    <Text style={[styles.explanationTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.connectionExplanationTitle', 'Connection status')}
                    </Text>
                    <Text style={[styles.explanationBody, { color: tc.secondaryText }]}>
                        {tFallback(
                            t,
                            'tdahToday.connectionExplanationBody',
                            "Mindwtr keeps a live connection to your server while ADHD Mode is on, so today's reminders arrive on time.",
                        )}
                    </Text>
                    {batteryLimited ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={onRequestBatteryExemption}
                            style={[styles.batteryButton, { borderColor: tc.tint }]}
                            testID="tdah-connection-request-battery-exemption"
                        >
                            <Text style={[styles.batteryButtonText, { color: tc.tint }]}>
                                {tFallback(t, 'tdahToday.connectionBatteryRequestButton', 'Allow unrestricted battery use')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'flex-start',
    },
    tapTarget: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 24,
        minWidth: 24,
        paddingVertical: 4,
    },
    batteryChip: {
        borderRadius: 6,
        borderWidth: 1,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    batteryChipText: {
        fontSize: 10,
        fontWeight: '700',
    },
    explanation: {
        marginTop: 6,
        borderRadius: 10,
        borderWidth: 1,
        padding: 10,
        gap: 6,
        maxWidth: 280,
    },
    explanationTitle: {
        fontSize: 13,
        fontWeight: '700',
    },
    explanationBody: {
        fontSize: 12,
    },
    batteryButton: {
        alignSelf: 'flex-start',
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 8,
        minHeight: 44,
        justifyContent: 'center',
    },
    batteryButtonText: {
        fontSize: 12,
        fontWeight: '700',
    },
});
