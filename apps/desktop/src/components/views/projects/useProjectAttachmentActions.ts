import { useCallback, useEffect, useState } from 'react';
import { type Attachment, type Project } from '@mindwtr/core';
import { importPickedFileAttachment } from '../../../lib/attachment-import';
import { openAttachmentTarget } from '../../../lib/open-attachment-target';
import { isTauriRuntime } from '../../../lib/runtime';
import { logWarn } from '../../../lib/app-log';

type UseProjectAttachmentActionsParams = {
    t: (key: string) => string;
    selectedProject: Project | undefined;
    updateProject: (projectId: string, updates: Partial<Project>) => void;
};

export function useProjectAttachmentActions({
    t,
    selectedProject,
    updateProject,
}: UseProjectAttachmentActionsParams) {
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const [showLinkPrompt, setShowLinkPrompt] = useState(false);
    const [isProjectAttachmentBusy, setIsProjectAttachmentBusy] = useState(false);

    useEffect(() => {
        setAttachmentError(null);
    }, [selectedProject?.id]);

    const openAttachment = useCallback(async (attachment: Attachment) => {
        try {
            await openAttachmentTarget(
                attachment.uri,
                attachment.kind === 'file' ? attachment.id : undefined,
            );
        } catch (error) {
            void logWarn('Failed to open attachment', {
                scope: 'attachment',
                extra: { error: error instanceof Error ? error.message : String(error) },
            });
            const message = error instanceof Error ? error.message : String(error);
            setAttachmentError(message || t('attachments.fileNotSupported'));
        }
    }, [t]);

    const addProjectFileAttachment = useCallback(async () => {
        if (!selectedProject) return;
        if (isProjectAttachmentBusy) return;
        if (!isTauriRuntime()) {
            setAttachmentError(t('attachments.fileNotSupported'));
            return;
        }
        setIsProjectAttachmentBusy(true);
        setAttachmentError(null);
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                multiple: false,
                directory: false,
                title: t('attachments.addFile'),
            });
            if (!selected || typeof selected !== 'string') return;
            const result = await importPickedFileAttachment(selected);
            if ('errorKey' in result) {
                setAttachmentError(t(result.errorKey));
                return;
            }
            updateProject(selectedProject.id, { attachments: [...(selectedProject.attachments || []), result.attachment] });
        } finally {
            setIsProjectAttachmentBusy(false);
        }
    }, [isProjectAttachmentBusy, selectedProject, t, updateProject]);

    const addProjectLinkAttachment = useCallback(() => {
        if (!selectedProject) return;
        setAttachmentError(null);
        setShowLinkPrompt(true);
    }, [selectedProject]);

    const removeProjectAttachment = useCallback((id: string) => {
        if (!selectedProject) return;
        const now = new Date().toISOString();
        const next = (selectedProject.attachments || []).map((attachment) =>
            attachment.id === id ? { ...attachment, deletedAt: now, updatedAt: now } : attachment
        );
        updateProject(selectedProject.id, { attachments: next });
    }, [selectedProject, updateProject]);

    return {
        attachmentError,
        setAttachmentError,
        showLinkPrompt,
        setShowLinkPrompt,
        isProjectAttachmentBusy,
        openAttachment,
        addProjectFileAttachment,
        addProjectLinkAttachment,
        removeProjectAttachment,
    };
}
