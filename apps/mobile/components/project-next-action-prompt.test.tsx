import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import renderer from 'react-test-renderer';
import { Text } from 'react-native';

import {
    buildProjectNextActionPromptState,
    presentProjectNextActionPrompt,
    ProjectNextActionPromptProvider,
} from './project-next-action-prompt';

const { addTask, updateTask, updateProject, showToast, parseNextActionInput, storeState } = vi.hoisted(() => ({
    addTask: vi.fn(),
    updateTask: vi.fn(),
    updateProject: vi.fn(),
    showToast: vi.fn(),
    parseNextActionInput: vi.fn((input: string, context: { projectId: string; sectionId?: string | null }) => ({
        title: `parsed:${input}`,
        props: { status: 'waiting', projectId: context.projectId, sectionId: context.sectionId },
    })),
    storeState: {
        addTask: vi.fn(),
        updateTask: vi.fn(),
        updateProject: vi.fn(),
        projects: [] as any[],
        _allProjects: [] as any[],
        tasks: [] as any[],
        _allTasks: [] as any[],
        _tasksById: new Map<string, any>(),
        areas: [] as any[],
        settings: { gtd: {} } as any,
    },
}));

const translate = vi.hoisted(() => {
    const labels: Record<string, string> = {
        'common.skip': 'Skip',
        'projects.nextActionPromptTitle': "What's the next action?",
        'projects.nextActionPromptDesc': 'Choose or add the next action for {{project}}.',
        'projects.nextActionPromptChooseExisting': 'Choose an existing task',
        'projects.nextActionPromptAddNew': 'Add a new next action',
        'projects.nextActionPromptPlaceholder': 'New next action...',
        'projects.nextActionPromptAddButton': 'Add next action',
        'projects.nextActionPromptComplete': 'Complete project',
        'status.waiting': 'Waiting',
    };
    return (key: string) => labels[key] ?? key;
});

vi.mock('@mindwtr/core', async (importOriginal) => {
    const { mockCore } = await import('../test-support/mock-core');
    storeState.addTask = addTask;
    storeState.updateTask = updateTask;
    storeState.updateProject = updateProject;
    // Real `getProjectNextActionPromptData` on purpose: the stub this replaced
    // dropped `scope` and the whole section-scoped branch, so #911 was untestable.
    return mockCore(importOriginal, () => storeState, {
        parseProjectNextActionInput: parseNextActionInput,
    });
});

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({ t: translate }),
}));

vi.mock('../hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        cardBg: '#ffffff',
        text: '#111111',
        secondaryText: '#666666',
        border: '#dddddd',
        inputBg: '#f3f4f6',
        filterBg: '#e5e7eb',
        tint: '#2563eb',
        onTint: '#ffffff',
    }),
}));

vi.mock('../contexts/toast-context', () => ({
    ToastViewport: () => null,
    useToast: () => ({
        showToast,
    }),
}));

describe('ProjectNextActionPromptProvider', () => {
    const flattenText = (value: unknown): string => {
        if (typeof value === 'string' || typeof value === 'number') return String(value);
        if (Array.isArray(value)) return value.map((item) => flattenText(item)).join('');
        if (value && typeof value === 'object') {
            const item = value as { children?: unknown; props?: { children?: unknown } };
            return flattenText(item.props?.children ?? item.children);
        }
        return '';
    };

    const hasText = (tree: renderer.ReactTestRenderer, text: string) =>
        tree.root.findAll((node) => flattenText(node.props?.children).includes(text)).length > 0;

    const currentTask = {
        id: 'current',
        title: 'Finish current step',
        status: 'next',
        projectId: 'project-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const candidateTask = {
        id: 'candidate',
        title: 'Draft follow-up',
        status: 'waiting',
        projectId: 'project-1',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const project = {
        id: 'project-1',
        title: 'Launch plan',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        storeState.projects = [project];
        storeState._allProjects = [project];
        storeState.tasks = [currentTask, candidateTask];
        storeState._allTasks = [currentTask, candidateTask];
        storeState._tasksById = new Map([
            [currentTask.id, currentTask],
            [candidateTask.id, candidateTask],
        ]);
        addTask.mockResolvedValue({ success: true, id: 'created-task' });
        updateTask.mockResolvedValue({ success: true });
        updateProject.mockResolvedValue({ success: true });
    });

    it('builds prompt data from an optimistic completed task snapshot', () => {
        const promptState = buildProjectNextActionPromptState({
            ...currentTask,
            status: 'done',
        } as any);

        expect(promptState?.projectId).toBe('project-1');
        expect(promptState?.candidates.map((task) => task.id)).toEqual(['candidate']);
    });

    it('keeps the prompt mounted after the triggering row unmounts', async () => {
        function Trigger({ visible }: { visible: boolean }) {
            if (!visible) return null;
            return (
                <Text
                    accessibilityLabel="Open next action prompt"
                    onPress={() => presentProjectNextActionPrompt({ ...currentTask, status: 'done' } as any)}
                >
                    Open
                </Text>
            );
        }

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <ProjectNextActionPromptProvider>
                    <Trigger visible />
                </ProjectNextActionPromptProvider>,
            );
            await Promise.resolve();
        });

        const trigger = tree.root.find((node) => node.props.accessibilityLabel === 'Open next action prompt');
        await renderer.act(async () => {
            trigger.props.onPress();
            await Promise.resolve();
        });

        expect(hasText(tree, "What's the next action?")).toBe(true);
        expect(hasText(tree, 'Draft follow-up')).toBe(true);

        await renderer.act(async () => {
            tree.update(
                <ProjectNextActionPromptProvider>
                    <Trigger visible={false} />
                </ProjectNextActionPromptProvider>,
            );
            await Promise.resolve();
        });

        expect(hasText(tree, 'Draft follow-up')).toBe(true);

        const candidate = tree.root.find((node) => node.props.accessibilityLabel === 'Draft follow-up');
        await renderer.act(async () => {
            candidate.props.onPress();
            await Promise.resolve();
        });

        expect(updateTask).toHaveBeenCalledWith('candidate', { status: 'next' });
    });

    it('keeps the prompt open and reports failed next-action updates', async () => {
        updateTask.mockResolvedValueOnce({ success: false, error: 'Project is locked' });

        function Trigger() {
            return (
                <Text
                    accessibilityLabel="Open next action prompt"
                    onPress={() => presentProjectNextActionPrompt({ ...currentTask, status: 'done' } as any)}
                >
                    Open
                </Text>
            );
        }

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <ProjectNextActionPromptProvider>
                    <Trigger />
                </ProjectNextActionPromptProvider>,
            );
            await Promise.resolve();
        });

        const trigger = tree.root.find((node) => node.props.accessibilityLabel === 'Open next action prompt');
        await renderer.act(async () => {
            trigger.props.onPress();
            await Promise.resolve();
        });

        const candidate = tree.root.find((node) => node.props.accessibilityLabel === 'Draft follow-up');
        await renderer.act(async () => {
            candidate.props.onPress();
            await Promise.resolve();
        });

        expect(hasText(tree, "What's the next action?")).toBe(true);
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Project is locked',
            tone: 'error',
        }));
    });

    it('keeps the prompt open and reports a synchronously thrown next-action update', async () => {
        updateTask.mockImplementationOnce(() => {
            throw new Error('Adapter failed immediately');
        });

        function Trigger() {
            return (
                <Text
                    accessibilityLabel="Open next action prompt"
                    onPress={() => presentProjectNextActionPrompt({ ...currentTask, status: 'done' } as any)}
                >
                    Open
                </Text>
            );
        }

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <ProjectNextActionPromptProvider>
                    <Trigger />
                </ProjectNextActionPromptProvider>,
            );
            await Promise.resolve();
        });

        const trigger = tree.root.find((node) => node.props.accessibilityLabel === 'Open next action prompt');
        await renderer.act(async () => {
            trigger.props.onPress();
            await Promise.resolve();
        });

        const candidate = tree.root.find((node) => node.props.accessibilityLabel === 'Draft follow-up');
        await renderer.act(async () => {
            candidate.props.onPress();
            await Promise.resolve();
        });

        expect(hasText(tree, "What's the next action?")).toBe(true);
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Adapter failed immediately',
            tone: 'error',
        }));
    });

    it('archives the project when the complete action is chosen', async () => {
        function Trigger() {
            return (
                <Text
                    accessibilityLabel="Open next action prompt"
                    onPress={() => presentProjectNextActionPrompt({ ...currentTask, status: 'done' } as any)}
                >
                    Open
                </Text>
            );
        }

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <ProjectNextActionPromptProvider>
                    <Trigger />
                </ProjectNextActionPromptProvider>,
            );
            await Promise.resolve();
        });

        const trigger = tree.root.find((node) => node.props.accessibilityLabel === 'Open next action prompt');
        await renderer.act(async () => {
            trigger.props.onPress();
            await Promise.resolve();
        });

        const completeButton = tree.root.find((node) => node.props.accessibilityLabel === 'Complete project');
        await renderer.act(async () => {
            completeButton.props.onPress();
            await Promise.resolve();
        });

        expect(updateProject).toHaveBeenCalledWith('project-1', { status: 'archived' });
        expect(hasText(tree, "What's the next action?")).toBe(false);
    });

    it('routes new next-action input through the quick-add parser (#859)', async () => {
        function Trigger() {
            return (
                <Text
                    accessibilityLabel="Open next action prompt"
                    onPress={() => presentProjectNextActionPrompt({ ...currentTask, status: 'done', sectionId: 'section-1' } as any)}
                >
                    Open
                </Text>
            );
        }

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <ProjectNextActionPromptProvider>
                    <Trigger />
                </ProjectNextActionPromptProvider>,
            );
            await Promise.resolve();
        });

        const trigger = tree.root.find((node) => node.props.accessibilityLabel === 'Open next action prompt');
        await renderer.act(async () => {
            trigger.props.onPress();
            await Promise.resolve();
        });

        const input = tree.root.find((node) => node.props.placeholder === 'New next action...');
        await renderer.act(async () => {
            input.props.onChangeText('Chase reply /waiting');
            await Promise.resolve();
        });

        const addButton = tree.root.find((node) => flattenText(node.props?.children) === 'Add next action' && Boolean(node.props.onPress));
        await renderer.act(async () => {
            addButton.props.onPress();
            await Promise.resolve();
        });

        expect(parseNextActionInput).toHaveBeenCalledWith('Chase reply /waiting', expect.objectContaining({
            projectId: 'project-1',
            sectionId: 'section-1',
            projects: storeState.projects,
        }));
        expect(addTask).toHaveBeenCalledWith('parsed:Chase reply /waiting', {
            status: 'waiting',
            projectId: 'project-1',
            sectionId: 'section-1',
        });
    });
});
