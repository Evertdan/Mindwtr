import { StyleSheet } from 'react-native';

// Borrowed from calendar-view.tsx's day timeline (its now-marker top-offset
// formula and 56dp hour-gutter convention only — spec Design Notes: a TDAH
// timeline is a simpler linear list keyed by startTime with no drag, so the
// column-layout/overlap-resolution machinery in calendar-day-items.ts /
// calendar-scheduling.ts is deliberately not reused).
export const TDAH_TIMELINE_DAY_START_HOUR = 0;
export const TDAH_TIMELINE_DAY_END_HOUR = 24;
export const TDAH_TIMELINE_PIXELS_PER_MINUTE = 1.4;
export const TDAH_TIMELINE_GUTTER_WIDTH = 56;
// Accessibility: targets of 48dp or more (epic-1-context.md UX patterns).
export const TDAH_TIMELINE_MIN_ROW_HEIGHT = 48;

export const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    headerDate: {
        fontSize: 20,
        fontWeight: '700',
    },
    headerRoutine: {
        fontSize: 13,
        marginTop: 2,
    },
    offlineBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginHorizontal: 16,
        marginBottom: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
    },
    offlineBannerText: {
        flex: 1,
        fontSize: 13,
    },
    scrollView: {
        flex: 1,
    },
    loadingHint: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 4,
        fontSize: 14,
    },
    // The loading-phase skeleton (AC: "skeleton con canal dibujado") — a
    // compact stand-in for `timelineArea` that reuses the same hour-channel
    // shapes (`hourLine`/`hourLabel`/`hourDivider`) plus a few placeholder
    // row blocks, so it reads as "the timeline's shape, loading" rather than
    // a bare spinner.
    loadingSkeleton: {
        position: 'relative',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 24,
    },
    skeletonRow: {
        position: 'absolute',
        left: TDAH_TIMELINE_GUTTER_WIDTH + 4,
        right: 0,
        height: TDAH_TIMELINE_MIN_ROW_HEIGHT,
        borderRadius: 10,
    },
    timelineArea: {
        position: 'relative',
        marginHorizontal: 16,
        marginBottom: 24,
    },
    hourLine: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        height: 18,
    },
    hourLabel: {
        width: TDAH_TIMELINE_GUTTER_WIDTH,
        fontSize: 11,
        fontWeight: '700',
        textAlign: 'right',
        paddingRight: 8,
    },
    hourDivider: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
    },
    nowLine: {
        position: 'absolute',
        left: TDAH_TIMELINE_GUTTER_WIDTH - 6,
        right: 0,
        height: 10,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 20,
    },
    nowDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    // UX-DR3's 8% primary halo: a circle ~2.5x the dot, centered behind it
    // (dot center is (4, 5) inside the 10px-tall nowLine container, so a
    // 20px halo sits at left -6 / top -5).
    nowHalo: {
        position: 'absolute',
        left: -6,
        top: -5,
        width: 20,
        height: 20,
        borderRadius: 10,
        opacity: 0.08,
    },
    // The HH:mm label at the line's gutter edge: spans the full hour-gutter
    // width (its text right edge lands where hourLabel's does, 8px of
    // padding in from the channel), keeping the real time readable exactly
    // where "now" crosses the channel.
    nowTimeLabel: {
        position: 'absolute',
        left: -(TDAH_TIMELINE_GUTTER_WIDTH - 6),
        width: TDAH_TIMELINE_GUTTER_WIDTH,
        top: -2,
        fontSize: 11,
        fontWeight: '700',
        textAlign: 'right',
        paddingRight: 8,
        fontVariant: ['tabular-nums'],
    },
    nowRule: {
        flex: 1,
        height: 2,
        marginLeft: 4,
    },
    rowWrapper: {
        position: 'absolute',
        left: TDAH_TIMELINE_GUTTER_WIDTH + 4,
        right: 0,
    },
    // The "sin hora" trailing section (doc 02's T-01 layout): a no-time
    // Activity has no vertical position to be absolutely positioned at
    // (`computeActivityLayout` returns `null` for it), so it renders in
    // normal document flow instead, one below the next.
    rowWrapperStatic: {
        position: 'relative',
        marginBottom: 8,
    },
    noTimeSection: {
        marginHorizontal: 16,
        marginBottom: 24,
        gap: 8,
    },
    noTimeSectionTitle: {
        fontSize: 13,
        fontWeight: '700',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 8,
        minHeight: TDAH_TIMELINE_MIN_ROW_HEIGHT,
    },
    rowGlyph: {
        marginTop: 2,
    },
    rowBody: {
        flex: 1,
        minWidth: 0,
    },
    rowTopLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
    },
    rowTime: {
        fontSize: 12,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    rowTitle: {
        fontSize: 14,
        fontWeight: '600',
        flexShrink: 1,
    },
    rowMetaLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 2,
    },
    rowMetaText: {
        fontSize: 11,
    },
    originBadge: {
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    originBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    emptyTitle: {
        fontSize: 17,
        fontWeight: '700',
        textAlign: 'center',
    },
    emptyBody: {
        fontSize: 14,
        textAlign: 'center',
    },
    ctaButton: {
        borderRadius: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaButtonText: {
        fontSize: 15,
        fontWeight: '700',
    },
    addManualFab: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
    },
    detailContainer: {
        flex: 1,
    },
    detailScroll: {
        padding: 16,
        gap: 16,
    },
    detailHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    detailTitle: {
        fontSize: 20,
        fontWeight: '700',
        flexShrink: 1,
    },
    fieldGroup: {
        gap: 6,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '600',
    },
    textInput: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
    },
    readOnlyValue: {
        fontSize: 14,
    },
    actionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    actionButton: {
        flexGrow: 1,
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: TDAH_TIMELINE_MIN_ROW_HEIGHT,
    },
    actionButtonText: {
        fontSize: 14,
        fontWeight: '700',
    },
    errorBanner: {
        borderRadius: 10,
        borderWidth: 1,
        padding: 12,
        gap: 8,
    },
    errorBannerText: {
        fontSize: 13,
    },
    footer: {
        padding: 16,
    },
    routineContext: {
        fontSize: 12,
    },
});
