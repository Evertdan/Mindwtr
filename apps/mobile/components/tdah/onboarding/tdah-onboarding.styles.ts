import { StyleSheet } from 'react-native';

/**
 * Shared layout for every T-14 step. Colors are never set here — every step
 * reads them from `useThemeColors()` (`focus`/`focus-dark`/`focus-light`
 * semantic tokens included) and applies them inline, per the "no hardcoded
 * hex" rule for this story.
 */
export const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        padding: 24,
        gap: 16,
    },
    closeRow: {
        alignItems: 'flex-end',
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    closeButton: {
        alignItems: 'center',
        borderRadius: 18,
        height: 36,
        justifyContent: 'center',
        width: 36,
    },
    title: {
        fontSize: 26,
        fontWeight: '800',
    },
    subtitle: {
        fontSize: 16,
        lineHeight: 23,
    },
    body: {
        fontSize: 15,
        lineHeight: 22,
    },
    footer: {
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'flex-end',
        padding: 24,
    },
    button: {
        alignItems: 'center',
        borderRadius: 12,
        justifyContent: 'center',
        minHeight: 48,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    buttonOutline: {
        borderWidth: 1,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '700',
    },
    card: {
        borderRadius: 14,
        borderWidth: 1,
        gap: 6,
        padding: 16,
    },
    cardTitle: {
        fontSize: 15,
        fontWeight: '700',
    },
    cardDescription: {
        fontSize: 13,
        lineHeight: 19,
    },
    row: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
        justifyContent: 'space-between',
    },
    inputLabel: {
        fontSize: 13,
        fontWeight: '700',
    },
    input: {
        borderRadius: 10,
        borderWidth: 1,
        fontSize: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    inputError: {
        fontSize: 12,
        fontWeight: '600',
    },
    badge: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '700',
    },
    centeredBody: {
        alignItems: 'center',
        flex: 1,
        gap: 16,
        justifyContent: 'center',
        padding: 24,
    },
});
