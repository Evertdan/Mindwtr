import { StyleSheet } from 'react-native';

// Accessibility: touch targets of 48dp or more (epic-1-context.md UX
// patterns), same floor tdah-today.styles.ts uses for its rows.
export const TDAH_DND_MIN_TOUCH_TARGET = 48;

export const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        gap: 16,
        paddingBottom: 48,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    centeredText: {
        fontSize: 15,
        textAlign: 'center',
    },
    banner: {
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    bannerText: {
        fontSize: 13,
    },
    section: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 14,
        gap: 10,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '700',
    },
    sectionHint: {
        fontSize: 13,
        lineHeight: 18,
    },
    statusValue: {
        fontSize: 18,
        fontWeight: '700',
    },
    promise: {
        fontSize: 13,
        lineHeight: 18,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: TDAH_DND_MIN_TOUCH_TARGET,
    },
    toggleLabel: {
        flexShrink: 1,
        fontSize: 14,
    },
    fieldRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
    },
    fieldLabel: {
        fontSize: 13,
    },
    input: {
        borderRadius: 8,
        borderWidth: 1,
        minWidth: 84,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 15,
    },
    inputWide: {
        borderRadius: 8,
        borderWidth: 1,
        flexGrow: 1,
        minWidth: 160,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 15,
    },
    errorText: {
        fontSize: 13,
    },
    windowRow: {
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
        gap: 6,
        minHeight: TDAH_DND_MIN_TOUCH_TARGET,
    },
    windowTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    windowMeta: {
        fontSize: 13,
    },
    windowActions: {
        flexDirection: 'row',
        gap: 16,
        marginTop: 4,
    },
    actionText: {
        fontSize: 14,
        fontWeight: '600',
        paddingVertical: 6,
    },
    primaryButton: {
        alignItems: 'center',
        borderRadius: 10,
        justifyContent: 'center',
        minHeight: TDAH_DND_MIN_TOUCH_TARGET,
        paddingHorizontal: 16,
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: '700',
    },
    dayChipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    dayChip: {
        borderRadius: 16,
        borderWidth: 1,
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    dayChipText: {
        fontSize: 13,
        fontWeight: '600',
    },
    editorActions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 4,
    },
});
