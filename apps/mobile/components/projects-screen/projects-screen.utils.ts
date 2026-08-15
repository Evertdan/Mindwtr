import { safeParseDate, type Project } from '@mindwtr/core';

export type ProjectStatusPalette = Record<Project['status'], { text: string; bg: string; border: string }>;

// Shared by the project rows and the detail modal so both read the same swatches.
export function buildProjectStatusPalette(tc: {
    border: string;
    filterBg: string;
    secondaryText: string;
    tint: string;
}): ProjectStatusPalette {
    return {
        active: { text: tc.tint, bg: `${tc.tint}22`, border: tc.tint },
        waiting: { text: '#F59E0B', bg: '#F59E0B22', border: '#F59E0B' },
        someday: { text: '#A855F7', bg: '#A855F722', border: '#A855F7' },
        archived: { text: tc.secondaryText, bg: tc.filterBg, border: tc.border },
    };
}

export function resolveAttachmentValidationMessage(
    error: string | undefined,
    t: (key: string) => string,
) {
    if (error === 'file_too_large') return t('attachments.fileTooLarge');
    if (error === 'mime_type_blocked' || error === 'mime_type_not_allowed') {
        return t('attachments.invalidFileType');
    }
    return t('attachments.fileNotSupported');
}

export function formatProjectDate(dateStr: string | undefined, notSetLabel: string) {
    if (!dateStr) return notSetLabel;
    try {
        const parsed = safeParseDate(dateStr);
        return parsed ? parsed.toLocaleDateString() : dateStr;
    } catch {
        return dateStr;
    }
}

export function normalizeProjectTag(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function buildProjectQuickCaptureReturnTo(projectId: string) {
    return `/projects-screen?projectId=${encodeURIComponent(projectId)}`;
}

/** Inverse of buildProjectQuickCaptureReturnTo: the project the capture route was opened from. */
export function getProjectQuickCaptureReturnToProjectId(returnTo: string | null | undefined): string | null {
    if (!returnTo) return null;
    const match = returnTo.match(/^\/projects-screen\?projectId=([^&]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
}
